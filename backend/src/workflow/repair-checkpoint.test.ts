import { describe, expect, it } from 'vitest';

import { createRepairCheckpoint } from './repair-checkpoint.js';
import { operationHash } from './operation-policy.js';

describe('repair checkpoints', () => {
  it('binds approved operations to the passing validation receipt', () => {
    const plan = {
      planId: 'plan-1', baselineRunId: 'baseline-1', completenessRunId: 'complete-1', snapshotId: 'snapshot-1', baseCommit: 'a'.repeat(40), ownerUserId: '7', status: 'running' as const, branchName: 'ai/repair/plan-1', validationId: null, warning: null, createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(), revision: 1,
      items: [{ id: 'item-1', planId: 'plan-1', sourceCheckId: 'check-1', category: 'build', title: 'Build', reason: 'Build failed.', risk: 'low' as const, affectedPaths: ['src/build.ts'], expectedTests: ['build'], approvalState: 'approved' as const, operations: [{ kind: 'modify' as const, path: 'src/build.ts', content: 'fixed', contentHash: 'hash', contentBytes: 5 }], workerStatus: 'applied' as const, approvalReceipt: { approvalId: 'approval-1', ownerUserId: '7', sessionId: 'session-1', actor: '7', sourceId: 'item-1', decision: 'approved' as const, operationHash: operationHash([{ kind: 'modify' as const, path: 'src/build.ts', content: 'fixed', contentHash: 'hash', contentBytes: 5 }]), previewHash: null, risk: 'low' as const, revision: 1, baseSnapshot: { snapshotId: 'snapshot-1', baseCommit: 'a'.repeat(40) }, createdAt: new Date(0).toISOString() } }],
    };
    const receipt = { validationId: 'validation-1', phase: 'repair' as const, sourceRunId: 'plan-1', status: 'passed' as const, checks: [], baseCommit: 'a'.repeat(40), branchName: 'ai/repair/plan-1', createdAt: new Date(0).toISOString() };
    const checkpoint = createRepairCheckpoint(plan, receipt);
    expect(checkpoint.snapshotId).toBe('snapshot-1');
    expect(checkpoint.operations).toHaveLength(1);
  });
});
