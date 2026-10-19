import { describe, expect, it } from 'vitest';

import { deliveryIdentityMatches, markDeliveryRecovery, upsertDeliveryReceipt } from './delivery-reconciler.js';

const identity = { ownerUserId: '7', version2RunId: 'version-1', baseCommit: 'a'.repeat(40), manifestHash: 'b'.repeat(64), branchName: 'ai/enhancement/version-1-bbbbbbbbbbbbbbbb' };

describe('delivery reconciliation receipts', () => {
  it('persists one receipt per external step and preserves the identity', () => {
    const first = upsertDeliveryReceipt(undefined, identity, 'branch', 'completed', { remoteId: identity.branchName });
    const second = upsertDeliveryReceipt(first, identity, 'commit', 'completed', { commitSha: 'c'.repeat(40) });
    expect(second).toHaveLength(2);
    expect(deliveryIdentityMatches(second[0], identity)).toBe(true);
  });

  it('marks an ambiguous step for reconciliation instead of treating it as success', () => {
    const receipts = markDeliveryRecovery(undefined, identity, 'pull_request', 'GITHUB_RESPONSE_AMBIGUOUS');
    expect(receipts[0].status).toBe('recovery_required');
    expect(receipts[0].errorCode).toBe('GITHUB_RESPONSE_AMBIGUOUS');
  });
});
