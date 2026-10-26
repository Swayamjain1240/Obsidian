import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { SessionStore } from '../auth/session-store.js';
import { DurableRunStore } from '../workflow/run-store.js';
import { DurableWorkflowStore } from '../workflow/store.js';
import { PrivacyDeletionService } from './deletion.js';

const config = {
  SNAPSHOT_ROOT: '',
  PRIVACY_SNAPSHOT_RETENTION_MS: 100,
  PRIVACY_WORKSPACE_RETENTION_MS: 100,
  PRIVACY_RUN_RETENTION_MS: 100,
  PRIVACY_PREVIEW_RETENTION_MS: 100,
  PRIVACY_AI_CONTEXT_RETENTION_MS: 100,
  PRIVACY_AUDIT_RETENTION_MS: 100,
  PRIVACY_CLEANUP_BATCH_SIZE: 10,
  PRIVACY_DELETION_ACTIVE_POLICY: 'block' as const,
};

class FailOnceOnWorkflowListStore extends DurableWorkflowStore {
  private shouldFail = true;

  public override async list<T>(ownerUserId: string, kind: Parameters<DurableWorkflowStore['list']>[1]): Promise<Array<{ id: string; value: T }>> {
    if (this.shouldFail && kind === 'workflow_aggregate') {
      this.shouldFail = false;
      throw new Error('temporary persistence failure');
    }
    return super.list<T>(ownerUserId, kind);
  }
}

class FailOnceOnRunningSaveStore extends DurableWorkflowStore {
  private shouldFail = true;

  public override async save<T>(ownerUserId: string, kind: Parameters<DurableWorkflowStore['save']>[1], id: string, value: T): Promise<void> {
    if (this.shouldFail && kind === 'deletion_request' && (value as { status?: string }).status === 'running') {
      this.shouldFail = false;
      throw new Error('temporary running-state persistence failure');
    }
    return super.save(ownerUserId, kind, id, value);
  }
}

describe('privacy deletion lifecycle', () => {
  it('blocks active account deletion and completes an idempotent retry after terminal state', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'obsidian-privacy-deletion-'));
    config.SNAPSHOT_ROOT = root;
    const target = path.join(root, 'snapshot');
    await mkdir(target);
    await writeFile(path.join(target, 'source.ts'), 'private source');
    const store = new DurableWorkflowStore();
    const sessions = new SessionStore('a'.repeat(32));
    const signed = sessions.create({ githubUserId: 7, githubLogin: 'user', accessToken: 'private-token' });
    const session = sessions.get(signed)!;
    await store.save('7', 'workflow_aggregate', 'workflow-1', { workflowId: 'workflow-1', status: 'running' });
    const service = new PrivacyDeletionService(config, store, sessions);
    const blocked = await service.request('7', session.sessionId, 'account');
    expect(blocked.status).toBe('blocked_active');
    await store.save('7', 'workflow_aggregate', 'workflow-1', { workflowId: 'workflow-1', status: 'cancelled' });
    await store.save('7', 'snapshot_handle', 'handle-1', { ownerUserId: '7', handle: 'handle-1', snapshot: { archivePath: path.join(target, 'repository.tar.gz') } });
    await store.save('7', 'privacy_cleanup', 'cleanup-1', { root, target, resourceId: 'snapshot-1', status: 'scheduled' });
    const completed = await service.retry('7', blocked.requestId);
    expect(completed.status).toBe('completed');
    expect(await store.get('7', 'privacy_cleanup', 'cleanup-1')).toBeNull();
    expect((await service.request('7', session.sessionId, 'account')).requestId).toBe(completed.requestId);
  });

  it('marks a recoverable persistence failure and resumes the same request on retry', async () => {
    const store = new FailOnceOnWorkflowListStore();
    const sessions = new SessionStore('c'.repeat(32));
    const signed = sessions.create({ githubUserId: 8, githubLogin: 'recoverable', accessToken: 'private-token' });
    const session = sessions.get(signed)!;
    const events: Array<{ eventType: string; baseCommit: string }> = [];
    const service = new PrivacyDeletionService(config, store, sessions, async (event) => { events.push({ eventType: event.eventType, baseCommit: event.baseCommit }); });

    const failed = await service.request('8', session.sessionId, 'account');
    expect(failed.status).toBe('failed');
    expect(failed.failureCode).toBe('PRIVACY_RECOVERY_REQUIRED');
    const completed = await service.retry('8', failed.requestId);
    expect(completed.status).toBe('completed');
    expect(events.some((event) => event.eventType === 'PRIVACY_DELETION_COMPLETED' && event.baseCommit === 'not_applicable')).toBe(true);
  });

  it('reconciles requested and running deletion records after restart', async () => {
    const store = new DurableWorkflowStore();
    const sessions = new SessionStore('d'.repeat(32));
    await store.save('9', 'deletion_request', 'restart-request', {
      requestId: 'restart-request', ownerUserId: '9', sessionId: 'restart-session', scope: 'account', targetId: null,
      status: 'running', protectedAudit: true, deletedStateCount: 0, deletedFilesystemCount: 0,
      failureCode: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), revision: 2,
    });
    const service = new PrivacyDeletionService(config, store, sessions);
    const result = await service.reconcilePending();
    expect(result.completed).toBe(1);
    expect((await service.get('9', 'restart-request'))?.status).toBe('completed');
  });

  it('does not leave a request stuck when persisting the running state fails once', async () => {
    const store = new FailOnceOnRunningSaveStore();
    const sessions = new SessionStore('e'.repeat(32));
    const signed = sessions.create({ githubUserId: 10, githubLogin: 'running-save', accessToken: 'private-token' });
    const session = sessions.get(signed)!;
    const service = new PrivacyDeletionService(config, store, sessions);

    const failed = await service.request('10', session.sessionId, 'account');
    expect(failed.status).toBe('failed');
    const completed = await service.retry('10', failed.requestId);
    expect(completed.status).toBe('completed');
  });

  it('blocks active durable runs and removes terminal run envelopes during deletion', async () => {
    const store = new DurableWorkflowStore();
    const runs = new DurableRunStore();
    const sessions = new SessionStore('f'.repeat(32));
    const signed = sessions.create({ githubUserId: 11, githubLogin: 'run-owner', accessToken: 'private-token' });
    const session = sessions.get(signed)!;
    await runs.saveEnvelope('11', 'run-active', 'detection', {
      version: 1, ownerUserId: '11', runId: 'run-active', phase: 'detection',
      result: { status: 'running', snapshotId: 'snapshot-run' }, lifecycleState: 'detecting', recovery: 'resumable', updatedAt: new Date().toISOString(),
    });
    const service = new PrivacyDeletionService(config, store, sessions, undefined, runs);
    const blocked = await service.request('11', session.sessionId, 'account');
    expect(blocked.status).toBe('blocked_active');

    await runs.saveEnvelope('11', 'run-active', 'detection', {
      version: 1, ownerUserId: '11', runId: 'run-active', phase: 'detection',
      result: { status: 'cancelled', snapshotId: 'snapshot-run' }, lifecycleState: 'cancelled', recovery: 'cancelled', updatedAt: new Date().toISOString(),
    });
    const completed = await service.retry('11', blocked.requestId);
    expect(completed.status).toBe('completed');
    expect(await runs.list('11')).toHaveLength(0);
  });
});
