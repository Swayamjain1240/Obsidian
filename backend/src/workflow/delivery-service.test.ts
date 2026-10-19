import { describe, expect, it } from 'vitest';

import { deliveryBranchName, deliveryCommitMessage, gitBlobSha, responseHash } from './delivery-service.js';

describe('delivery identity helpers', () => {
  it('derives stable branch and commit identities from the manifest', () => {
    expect(deliveryBranchName('version/2', 'A'.repeat(64))).toBe(`ai/enhancement/version-2-${'a'.repeat(16)}`);
    expect(deliveryCommitMessage('version-2', 'b'.repeat(64))).toContain('version-2 (bbbbbbbbbbbbbbbb)');
    expect(deliveryBranchName('version-2', 'b'.repeat(64))).toBe(deliveryBranchName('version-2', 'b'.repeat(64)));
  });

  it('hashes structured responses and Git blobs deterministically', () => {
    expect(responseHash({ number: 1 })).toHaveLength(64);
    expect(gitBlobSha('hello')).toBe('b6fc4c620b67d95f953a5c1c1230aaab5db5a1b0');
  });
});
