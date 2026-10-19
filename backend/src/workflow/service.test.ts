import { describe, expect, it } from 'vitest';

import { loadConfig } from '../config.js';
import { DurableWorkflowStore } from './store.js';
import { WorkflowService, WorkflowServiceError } from './service.js';
import { operationHash, normalizeOperations } from './operation-policy.js';

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
         { id: 'build', category: 'build' as const, label: 'Build', status: 'failed' as const, summary: 'Build failed.', commandLabel: null, exitCode: 1, durationMs: 1, evidenceRefs: [{ path: 'src/build.ts', reason: 'Build evidence.' }] },
         { id: 'lint', category: 'lint' as const, label: 'Lint', status: 'failed' as const, summary: 'Lint failed.', commandLabel: null, exitCode: 1, durationMs: 1, evidenceRefs: [{ path: 'src/lint.ts', reason: 'Lint evidence.' }] },
         { id: 'unit', category: 'unit' as const, label: 'Unit tests', status: 'failed' as const, summary: 'Unit tests failed.', commandLabel: null, exitCode: 1, durationMs: 1, evidenceRefs: [{ path: 'src/unit.ts', reason: 'Unit evidence.' }] },
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

     await workflow.approveRepairItem('7', plan.planId, item.id, true, [{ kind: 'add', path: 'src/first.ts', content: 'first' }]);
     await expect(workflow.approveRepairItem('7', plan.planId, item.id, true, [{ kind: 'add', path: 'src/second.ts', content: 'second' }])).rejects.toMatchObject<WorkflowServiceError>({ code: 'WORKFLOW_STATE_INVALID' });

    const second = plan.items[1];
    await workflow.approveRepairItem('7', plan.planId, second.id, false);
     await expect(workflow.approveRepairItem('7', plan.planId, second.id, true, [{ kind: 'add', path: 'src/reopened.ts', content: 'reopened' }])).rejects.toMatchObject<WorkflowServiceError>({ code: 'WORKFLOW_STATE_INVALID' });
  });

  it('serializes concurrent approvals for one plan', async () => {
    const workflow = service();
    const plan = await workflow.createRepairPlan('7', 'workflow-baseline');
    const item = plan.items[0];
    const results = await Promise.allSettled([
       workflow.approveRepairItem('7', plan.planId, item.id, true, [{ kind: 'add', path: 'src/race-a.ts', content: 'a' }]),
       workflow.approveRepairItem('7', plan.planId, item.id, true, [{ kind: 'add', path: 'src/race-b.ts', content: 'b' }]),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
  });

  it('uses a shared store revision to reject a stale second service instance', async () => {
    const value = fixture();
    const store = new DurableWorkflowStore();
    const first = new WorkflowService(config, value.baseline, value.completeness, store);
    const second = new WorkflowService(config, value.baseline, value.completeness, store);
    const plan = await first.createRepairPlan('7', 'workflow-baseline');
    const item = plan.items[0];
    const results = await Promise.allSettled([
      first.approveRepairItem('7', plan.planId, item.id, true, [{ kind: 'add', path: 'src/first.ts', content: 'first' }], { expectedRevision: plan.revision }),
      second.approveRepairItem('7', plan.planId, item.id, true, [{ kind: 'add', path: 'src/second.ts', content: 'second' }], { expectedRevision: plan.revision }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
  });

  it('blocks enhancement after a partial FULL-scope baseline', async () => {
    const workflow = service('FULL', 'partial');
    await expect(workflow.createEnhancementRun('7', 'workflow-baseline')).rejects.toMatchObject<WorkflowServiceError>({ code: 'WORKFLOW_STATE_INVALID' });
  });

  it('does not leave the parent enhancement running when Version 2 build fails', async () => {
    const workflow = service('EXISTING_ONLY', 'failed');
    const run = await workflow.createEnhancementRun('7', 'workflow-baseline');
    const recommendation = run.recommendations[0];
    const approved = await workflow.approveRecommendation('7', run.enhancementRunId, recommendation.id, true, [{ kind: 'modify', path: 'src/index.ts', content: 'updated' }], { expectedRevision: run.revision });

    const version2 = await workflow.startVersion2('7', approved.enhancementRunId, { expectedRevision: approved.revision });

    expect(version2.status).toBe('failed');
    expect(version2.enhancement.status).toBe('failed');
  });

  it('persists a recommendation viewed receipt across the workflow store', async () => {
    const store = new DurableWorkflowStore();
    const value = fixture();
    const workflow = new WorkflowService(config, value.baseline, value.completeness, store);
    const run = await workflow.createEnhancementRun('7', 'workflow-baseline', { sessionId: 'workflow-session' });
    const recommendation = run.recommendations[0];

    await workflow.viewRecommendation('7', run.enhancementRunId, recommendation.id, 'workflow-session');

    const records = [...(store as unknown as { cache: Map<string, unknown> }).cache.entries()].filter(([key]) => key.includes(':recommendation_review:'));
    expect(records).toHaveLength(1);
    expect(records[0][1]).toMatchObject({ action: 'viewed', recommendationId: recommendation.id, enhancementRunId: run.enhancementRunId });
  });

  it('cancels a queued Version 2 run without creating a workspace or PR-ready state', async () => {
    const store = new DurableWorkflowStore();
    const value = fixture();
    const workflow = new WorkflowService(config, value.baseline, value.completeness, store);
    const now = new Date(0).toISOString();
    await store.saveVersioned('7', 'enhancement_run', 'enhancement-queued', { enhancementRunId: 'enhancement-queued', baselineRunId: 'workflow-baseline', completenessRunId: 'workflow-completeness', snapshotId: 'workflow-snapshot', baseCommit: 'a'.repeat(40), ownerUserId: '7', scopeMode: 'EXISTING_ONLY' as const, status: 'running' as const, recommendations: [], warning: null, createdAt: now, updatedAt: now, revision: 1, sessionId: 'workflow-session' });
    await store.saveVersioned('7', 'version_2_run', 'version-queued', { version2RunId: 'version-queued', ownerUserId: '7', status: 'queued' as const, enhancementRunId: 'enhancement-queued', sessionId: 'workflow-session', manifest: null, receipt: null, operations: [], revision: 1 });

    const cancelled = await workflow.cancelVersion2('7', 'version-queued', { expectedRevision: 1, sessionId: 'workflow-session' });

    expect(cancelled.status).toBe('cancelled');
    await expect(workflow.getEnhancementRun('7', 'enhancement-queued', 'workflow-session')).resolves.toMatchObject({ status: 'cancelled' });
    await expect(workflow.validateVersion2('7', 'version-queued', { expectedRevision: cancelled.revision, sessionId: 'workflow-session' })).rejects.toMatchObject<WorkflowServiceError>({ code: 'WORKFLOW_STATE_INVALID' });
  });

  it('requires an exact preview hash and explicit confirmation for high-risk approvals', async () => {
    const value = fixture();
    const original = value.baseline.get();
    value.baseline.get = () => ({ ...original, checks: [{ ...original.checks[0], category: 'security' as const }, ...original.checks.slice(1)] });
    const workflow = new WorkflowService(config, value.baseline, value.completeness, new DurableWorkflowStore());
    const plan = await workflow.createRepairPlan('7', 'workflow-baseline');
    const operations = [{ kind: 'modify' as const, path: 'src/build.ts', content: 'fixed' }];
    const normalized = normalizeOperations(operations);
    await expect(workflow.approveRepairItem('7', plan.planId, plan.items[0].id, true, operations)).rejects.toMatchObject<WorkflowServiceError>({ code: 'WORKFLOW_INPUT_INVALID' });
    await expect(workflow.approveRepairItem('7', plan.planId, plan.items[0].id, true, operations, { previewHash: operationHash(normalized), highRiskConfirmed: true })).resolves.toBeTruthy();
  });

  it('rebuilds a recovery-required Version 2 run and records a failed retry when the workspace cannot be reconstructed', async () => {
    const value = fixture();
    const store = new DurableWorkflowStore();
    const workflow = new WorkflowService(config, value.baseline, value.completeness, store);
    const operations = normalizeOperations([{ kind: 'modify', path: 'src/build.ts', content: 'fixed' }]);
    const now = new Date(0).toISOString();
    await store.saveVersioned('7', 'enhancement_run', 'enhancement-1', {
      enhancementRunId: 'enhancement-1', baselineRunId: 'workflow-baseline', completenessRunId: 'workflow-completeness', snapshotId: 'workflow-snapshot', baseCommit: 'a'.repeat(40), ownerUserId: '7', scopeMode: 'EXISTING_ONLY' as const, status: 'running' as const, recommendations: [], warning: null, createdAt: now, updatedAt: now, revision: 1, sessionId: 'workflow-session',
    });
    await store.saveVersioned('7', 'version_2_run', 'version-2', {
      version2RunId: 'version-2', ownerUserId: '7', status: 'recovery_required' as const, enhancementRunId: 'enhancement-1', sessionId: 'workflow-session', manifest: {
        manifestId: 'manifest-1', version2RunId: 'version-2', baseCommit: 'a'.repeat(40), targetBranch: 'ai/enhancement/version-2', added: [], modified: ['src/build.ts'], deleted: [], approvedRepairIds: [], approvedRecommendationIds: ['recommendation-1'], rollbackRef: 'a'.repeat(40), diffHash: operationHash(operations), diffSummary: ['modify: src/build.ts'], generatedAt: now, snapshotId: 'workflow-snapshot', operationHash: operationHash(operations),
      }, receipt: null, operations, snapshotId: 'workflow-snapshot', branchName: 'ai/enhancement/version-2', revision: 1,
    });

    const result = await workflow.retryVersion2('7', 'version-2', { expectedRevision: 1, sessionId: 'workflow-session' });

    expect(result.status).toBe('failed');
    expect(result.warning).toBeTruthy();
    expect(result.revision).toBeGreaterThan(1);
    await expect(workflow.getEnhancementRun('7', 'enhancement-1', 'workflow-session')).resolves.toMatchObject({ status: 'failed' });
    await expect(workflow.validateVersion2('7', 'version-2', { expectedRevision: result.revision, sessionId: 'workflow-session' })).rejects.toMatchObject<WorkflowServiceError>({ code: 'WORKFLOW_STATE_INVALID' });
  });

  it('does not allow a session-bound read to use a legacy unbound workflow record', async () => {
    const store = new DurableWorkflowStore();
    const value = fixture();
    const workflow = new WorkflowService(config, value.baseline, value.completeness, store);
    const now = new Date(0).toISOString();
    await store.save('7', 'repair_plan', 'legacy-plan', {
      planId: 'legacy-plan', baselineRunId: 'workflow-baseline', completenessRunId: 'workflow-completeness', snapshotId: 'workflow-snapshot', baseCommit: 'a'.repeat(40), ownerUserId: '7', status: 'blocked' as const, branchName: null, items: [], validationId: null, warning: null, createdAt: now, updatedAt: now, revision: 1,
    });

    await expect(workflow.getRepairPlan('7', 'legacy-plan', 'new-session')).rejects.toMatchObject<WorkflowServiceError>({ code: 'WORKFLOW_NOT_FOUND' });
  });
});
