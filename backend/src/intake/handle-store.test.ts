import { describe, expect, it } from 'vitest';

import { SnapshotHandleStore } from './handle-store.js';
import type { SnapshotRecord } from './snapshot.js';

const snapshot: SnapshotRecord = {
  snapshotId: 'snapshot-1',
  repository: { owner: 'owner', name: 'repo', branch: 'main', commitSha: 'a'.repeat(40) },
  archivePath: 'private/archive.tar.gz',
  manifestPath: 'private/snapshot.json',
  archiveSha256: 'b'.repeat(64),
  byteLength: 10,
  capturedAt: new Date(0).toISOString(),
  immutable: true,
};

describe('snapshot handle store', () => {
  it('binds a handle to its authenticated owner and expires it', () => {
    const store = new SnapshotHandleStore(10);
    const handle = store.create('user-1', snapshot, 1000);

    expect(store.get('user-1', handle, 1001)?.snapshotId).toBe('snapshot-1');
    expect(store.get('user-2', handle, 1001)).toBeNull();
    expect(store.get('user-1', handle, 1011)).toBeNull();
  });
});
