import { describe, expect, it } from 'vitest';

import { loadConfig } from '../config.js';
import { DurableWorkflowStore } from './store.js';
import { WorkflowService, WorkflowServiceError } from './service.js';

const config = loadConfig({
  NODE_ENV: 'test',
  MONGODB_URI: 'mongodb://127.0.0.1:27017/obsidian-test',
  FRONTEND_ORIGIN: 'http://localhost:5173',
  AUTH_SESSION_SECRET: 'a'.repeat(32),
});

function fixture(scopeMode: 'FULL' | 'EXISTING_ONLY' = 'EXISTING_ONLY', status: 'failed' | 'partial' = 'failed') {
  const snapshot = {
    snapshotId: 'workflow-snapshot',
    repository: { owner: 'owner', name: 'repo', branch: 'main', commitSha: 'a'.repeat(40) },
    archivePath: 'archive.tar.gz',
    manifestPath: 'snapshot.json',
    archiveSha256: 'b'.repeat(64),
    byteLength: 1,
    capturedAt: new Date(0).toISOString(),
    immutable: true as const,
  };
  const context = {
    detectionRunId: 'workflow-detection',
    ownerUserId: '7',
    sessionId: 'workflow-session',
    snapshot,
    baseCommit: 'a'.repeat(40),
    archiveSha256: snapshot.archiveSha256,
    languageCandidates: ['TypeScript'],
  };
  const baseline = {
    get: () => ({
      runId: 'workflow-baseline',
      completenessRunId: 'workflow-completeness',
      snapshotId: snapshot.snapshotId,
      baseCommit: context.baseCommit,
      status,
      checks: [
        { id: 'build', category: 'build' as const, label: 'Build', status: 'failed' as const, summary: 'Build failed.', commandLabel: null, exitCode: 1, durationMs: 1, evidenceRefs: [] },
        { id: 'lint', category: 'lint' as const, label: 'Lint', status: 'failed' as const, summary: 'Lint failed.', commandLabel: null, exitCode: 1, durationMs: 1, evidenceRefs: [] },
        { id: 'unit', category: 'unit' as const, label: 'Unit tests', status: 'failed' as const, summary: 'Unit tests failed.', commandLabel: null, exitCode: 1, durationMs: 1, evidenceRefs: [] },
      ],
    }),
    selectedContext: () => ({ completenessRunId: 'workflow-completeness', scopeMode, context }),
  };
  const completeness = { get: async () => ({ areas: [{ id: 'implementation', name: 'Implementation', status: 'working' as const, summary: 'Present.', findingIds: [], affectedPaths: ['src'] }] }) };
  return { baseline, completeness };
}

function service(scopeMode: 'FULL' | 'EXISTING_ONLY' = 'EXISTING_ONLY', status: 'failed' | 'partial' = 'failed') {
  const value = fixture(scopeMode, status);
  return new WorkflowService(config, value.baseline, value.completeness, new DurableWorkflowStore());
}

describe('workflow approval integrity', () => {
  it('rejects edits after an item is approved or rejected', async () => {
    const workflow = service();
    const plan = await workflow.createRepairPlan('7', 'workflow-baseline');
    const item = plan.items[0];

    await workflow.approveRepairItem('7', plan.planId, item.id, true, [{ kind: 'add', path: 'first.ts', content: 'first' }]);
    await expect(workflow.approveRepairItem('7', plan.planId, item.id, true, [{ kind: 'add', path: 'second.ts', content: 'second' }])).rejects.toMatchObject<WorkflowServiceError>({ code: 'WORKFLOW_STATE_INVALID' });

    const second = plan.items[1];
    await workflow.approveRepairItem('7', plan.planId, second.id, false);
    await expect(workflow.approveRepairItem('7', plan.planId, second.id, true, [{ kind: 'add', path: 'reopened.ts', content: 'reopened' }])).rejects.toMatchObject<WorkflowServiceError>({ code: 'WORKFLOW_STATE_INVALID' });
  });

  it('serializes concurrent approvals for one plan', async () => {
    const workflow = service();
    const plan = await workflow.createRepairPlan('7', 'workflow-baseline');
    const item = plan.items[0];
    const results = await Promise.allSettled([
      workflow.approveRepairItem('7', plan.planId, item.id, true, [{ kind: 'add', path: 'race-a.ts', content: 'a' }]),
      workflow.approveRepairItem('7', plan.planId, item.id, true, [{ kind: 'add', path: 'race-b.ts', content: 'b' }]),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
  });

  it('blocks enhancement after a partial FULL-scope baseline', async () => {
    const workflow = service('FULL', 'partial');
    await expect(workflow.createEnhancementRun('7', 'workflow-baseline')).rejects.toMatchObject<WorkflowServiceError>({ code: 'WORKFLOW_STATE_INVALID' });
  });
});
