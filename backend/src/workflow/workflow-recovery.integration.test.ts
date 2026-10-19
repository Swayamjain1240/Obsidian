import { describe, expect, it } from 'vitest';

import { DurableRunStore } from './run-store.js';

describe('workflow recovery integration', () => {
  it('rehydrates a recovery-required envelope without executing a side effect', async () => {
    const store = new DurableRunStore();
    await store.saveEnvelope('7', 'version-2', 'baseline', {
      version: 1,
      ownerUserId: '7',
      runId: 'version-2',
      phase: 'baseline',
      result: { status: 'recovery_required' },
      context: { snapshotId: 'snapshot-1', baseCommit: 'a'.repeat(40) },
      lifecycleState: 'paused',
      recovery: 'recovery_required',
      updatedAt: new Date(0).toISOString(),
    });
    const restored = await store.getEnvelope<{ status: string }, { snapshotId: string; baseCommit: string }>('7', 'version-2');
    expect(restored?.recovery).toBe('recovery_required');
    expect(restored?.result.status).toBe('recovery_required');
  });
});
