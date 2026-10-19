import { describe, expect, it } from 'vitest';

import { ApprovalLedger } from './approval-ledger.js';
import { DurableWorkflowStore } from './store.js';

describe('approval ledger', () => {
  it('stores an owner-bound immutable approval receipt', async () => {
    const ledger = new ApprovalLedger(new DurableWorkflowStore());
    const receipt = { approvalId: 'approval-1', ownerUserId: '7', sessionId: 'session-1', actor: '7', sourceId: 'item-1', decision: 'approved' as const, operationHash: 'a'.repeat(64), previewHash: null, risk: 'low' as const, revision: 1, baseSnapshot: { snapshotId: 'snapshot-1', baseCommit: 'b'.repeat(40) }, createdAt: new Date(0).toISOString() };
    await ledger.record(receipt);
    expect((await ledger.get('7', 'approval-1'))?.sourceId).toBe('item-1');
    expect(await ledger.get('8', 'approval-1')).toBeNull();
  });
});
