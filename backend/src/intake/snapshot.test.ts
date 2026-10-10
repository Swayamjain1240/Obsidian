import { describe, expect, it } from 'vitest';

import { createSnapshotId, sha256 } from './snapshot.js';

describe('snapshot identity', () => {
  it('creates a stable content hash and snapshot id', () => {
    const contentHash = sha256(new TextEncoder().encode('archive-content'));
    const repository = { owner: 'owner', name: 'repo', branch: 'main' };

    expect(contentHash).toHaveLength(64);
    expect(createSnapshotId(repository, contentHash)).toHaveLength(32);
    expect(createSnapshotId(repository, contentHash)).toBe(createSnapshotId(repository, contentHash));
  });
});
