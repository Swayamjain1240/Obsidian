import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { DurableWorkflowStore } from '../workflow/store.js';
import { DurableRunStore } from '../workflow/run-store.js';
import type { WorkflowPage, WorkflowPageCursor } from '../workflow/store.js';
import { PrivacyRetentionService } from './retention-service.js';
import { retentionPolicy } from './retention.js';

const policy = { snapshotMs: 10, workspaceMs: 10, runMs: 10, previewMs: 10, aiContextMs: 10, auditMs: 10, cleanupBatchSize: 10, deletionActivePolicy: 'block' as const };

class ObservedCleanupStore extends DurableWorkflowStore {
  public readonly pageCalls: Array<{ limit: number; cursor?: WorkflowPageCursor }> = [];

  public override async listCleanupTasksPage<T>(ownerUserId: string, dueAt: number, limit: number, cursor?: WorkflowPageCursor): Promise<WorkflowPage<T>> {
    this.pageCalls.push({ limit, cursor });
    return super.listCleanupTasksPage<T>(ownerUserId, dueAt, limit, cursor);
  }
}

describe('privacy retention enforcement', () => {
  it('persists cleanup tasks and retries due filesystem cleanup after restart', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'obsidian-privacy-retention-'));
    const target = path.join(root, 'workspace');
    await mkdir(target);
    await writeFile(path.join(target, 'private.txt'), 'private');
    const store = new DurableWorkflowStore();
    const service = new PrivacyRetentionService(store, policy);
    const task = await service.schedule({ ownerUserId: '7', category: 'workspace', resourceId: 'w1', root, target, terminalAt: Date.now() - 20 });
    expect(task.status).toBe('scheduled');
    const result = await service.runDue('7');
    expect(result.completed).toBe(1);
    const restarted = new PrivacyRetentionService(store, policy);
    expect((await restarted.runDue('7')).attempted).toBe(0);
  });

  it('does not remove a resource referenced by an active workflow', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'obsidian-privacy-retention-active-'));
    const target = path.join(root, 'workspace');
    await mkdir(target);
    await writeFile(path.join(target, 'private.txt'), 'private');
    const store = new DurableWorkflowStore();
    await store.save('7', 'workflow_aggregate', 'workflow-1', { workflowId: 'workflow-1', snapshotId: 'snapshot-1', status: 'running' });
    const service = new PrivacyRetentionService(store, policy);
    await service.schedule({ ownerUserId: '7', category: 'snapshot', resourceId: 'snapshot-1', root, target, terminalAt: Date.now() - 20 });
    expect((await service.runDue('7')).attempted).toBe(0);
  });

  it('protects resources referenced by active non-aggregate workflow state', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'obsidian-privacy-retention-repair-'));
    const target = path.join(root, 'workspace');
    await mkdir(target);
    await writeFile(path.join(target, 'private.txt'), 'private');
    const store = new DurableWorkflowStore();
    await store.save('7', 'repair_plan', 'repair-1', { planId: 'repair-1', snapshotId: 'snapshot-2', status: 'running' });
    const service = new PrivacyRetentionService(store, policy);
    await service.schedule({ ownerUserId: '7', category: 'snapshot', resourceId: 'snapshot-2', root, target, terminalAt: Date.now() - 20 });
    expect((await service.runDue('7')).attempted).toBe(0);
  });

  it('processes due cleanup tasks in bounded batches and continues on later runs', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'obsidian-privacy-retention-batch-'));
    const store = new DurableWorkflowStore();
    const batchedPolicy = { ...policy, cleanupBatchSize: 2 };
    const service = new PrivacyRetentionService(store, batchedPolicy);
    const targets = await Promise.all([0, 1, 2].map(async (index) => {
      const target = path.join(root, `workspace-${index}`);
      await mkdir(target);
      await writeFile(path.join(target, 'private.txt'), 'private');
      return target;
    }));
    for (const [index, target] of targets.entries()) {
      await service.schedule({ ownerUserId: '7', category: 'workspace', resourceId: `batch-${index}`, root, target, terminalAt: Date.now() - 20 });
    }

    const first = await service.runDue('7');
    expect(first.attempted).toBe(2);
    expect(first.completed).toBe(2);
    const second = await service.runDue('7');
    expect(second.attempted).toBe(1);
    expect(second.completed).toBe(1);
  });

  it('uses bounded storage pages and resumes safely after a service restart', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'obsidian-privacy-retention-page-'));
    const store = new ObservedCleanupStore();
    const batchedPolicy = { ...policy, cleanupBatchSize: 2 };
    const service = new PrivacyRetentionService(store, batchedPolicy);
    for (const index of [0, 1, 2]) {
      const target = path.join(root, `workspace-${index}`);
      await mkdir(target);
      await writeFile(path.join(target, 'private.txt'), 'private');
      await service.schedule({ ownerUserId: '7', category: 'workspace', resourceId: `page-${index}`, root, target, terminalAt: Date.now() - 20 });
    }

    await service.runDue('7');
    const restarted = new PrivacyRetentionService(store, batchedPolicy);
    const second = await restarted.runDue('7');
    expect(store.pageCalls).toHaveLength(2);
    expect(store.pageCalls.every((call) => call.limit === 2)).toBe(true);
    expect(store.pageCalls[0].cursor).toBeUndefined();
    expect(store.pageCalls[1].cursor).toBeUndefined();
    expect(second.completed).toBe(1);
  });

  it('backs off a failed task so unrelated due work can progress', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'obsidian-privacy-retention-failure-'));
    const outside = path.join(root, 'outside');
    await mkdir(outside);
    const failedTarget = path.join(root, 'failed');
    await symlink(outside, failedTarget, 'junction');
    const goodTarget = path.join(root, 'good');
    await mkdir(goodTarget);
    await writeFile(path.join(goodTarget, 'private.txt'), 'private');
    const store = new DurableWorkflowStore();
    const service = new PrivacyRetentionService(store, { ...policy, cleanupBatchSize: 1 });
     const now = Date.now();
     await service.schedule({ ownerUserId: '7', category: 'workspace', resourceId: 'failed', root, target: failedTarget, terminalAt: now - 30 });
     await service.schedule({ ownerUserId: '7', category: 'workspace', resourceId: 'good', root, target: goodTarget, terminalAt: now - 20 });

    const first = await service.runDue('7');
    const second = await service.runDue('7');
    expect(first.failed).toBe(1);
    expect(second.completed).toBe(1);
  });

  it('discovers tasks inserted after an earlier bounded page', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'obsidian-privacy-retention-new-'));
    const store = new DurableWorkflowStore();
    const policyWithOne = { ...policy, cleanupBatchSize: 1 };
    const service = new PrivacyRetentionService(store, policyWithOne);
    const makeTarget = async (name: string) => {
      const target = path.join(root, name);
      await mkdir(target);
      await writeFile(path.join(target, 'private.txt'), 'private');
      return target;
    };
    const firstTarget = await makeTarget('first');
    const secondTarget = await makeTarget('second');
    await service.schedule({ ownerUserId: '7', category: 'workspace', resourceId: 'first', root, target: firstTarget, terminalAt: Date.now() - 20 });
    await service.schedule({ ownerUserId: '7', category: 'workspace', resourceId: 'second', root, target: secondTarget, terminalAt: Date.now() - 20 });
    expect((await service.runDue('7')).completed).toBe(1);
    const insertedTarget = await makeTarget('inserted');
    await service.schedule({ ownerUserId: '7', category: 'workspace', resourceId: 'inserted', root, target: insertedTarget, terminalAt: Date.now() - 20 });
    expect((await service.runDue('7')).completed).toBe(1);
    expect((await service.runDue('7')).completed).toBe(1);
  });

  it('uses durable claims to avoid duplicate cleanup under concurrent services', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'obsidian-privacy-retention-concurrent-'));
    const store = new DurableWorkflowStore();
    const policyWithTwo = { ...policy, cleanupBatchSize: 2 };
    const firstService = new PrivacyRetentionService(store, policyWithTwo);
    const secondService = new PrivacyRetentionService(store, policyWithTwo);
    for (const index of [0, 1]) {
      const target = path.join(root, `workspace-${index}`);
      await mkdir(target);
      await writeFile(path.join(target, 'private.txt'), 'private');
      await firstService.schedule({ ownerUserId: '7', category: 'workspace', resourceId: `concurrent-${index}`, root, target, terminalAt: Date.now() - 20 });
    }
    const [first, second] = await Promise.all([firstService.runDue('7'), secondService.runDue('7')]);
    expect(first.completed + second.completed).toBe(2);
    expect(first.failed + second.failed).toBe(0);
  });

  it('removes expired terminal durable run envelopes while retaining active runs', async () => {
    const store = new DurableWorkflowStore();
    const runs = new DurableRunStore();
    const old = new Date().toISOString();
    await runs.saveEnvelope('7', 'terminal-run', 'baseline', {
      version: 1, ownerUserId: '7', runId: 'terminal-run', phase: 'baseline',
      result: { status: 'failed' }, lifecycleState: 'baseline_testing', recovery: 'failed', updatedAt: old,
    });
    await runs.saveEnvelope('7', 'active-run', 'baseline', {
      version: 1, ownerUserId: '7', runId: 'active-run', phase: 'baseline',
      result: { status: 'running' }, lifecycleState: 'baseline_testing', recovery: 'resumable', updatedAt: old,
    });
    const service = new PrivacyRetentionService(store, policy, runs);
    await service.runDueAll(Date.now() + 20);
    expect((await runs.list('7')).map((entry) => entry.runId)).toEqual(['active-run']);
  });
});
