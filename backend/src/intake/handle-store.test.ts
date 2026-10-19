import { describe, expect, it } from 'vitest';

import { SnapshotHandleStore } from './handle-store.js';

const snapshot = {
  snapshotId: 'snapshot-1',
  repository: { owner: 'owner', name: 'repo', branch: 'main', commitSha: 'a'.repeat(40) },
  archivePath: 'archive.tar.gz',
  manifestPath: 'manifest.json',
  archiveSha256: 'b'.repeat(64),
  byteLength: 1,
  capturedAt: new Date(0).toISOString(),
  immutable: true as const,
};

describe('snapshot handle durability', () => {
  it('rehydrates a persisted owner-bound handle after the cache is recreated', async () => {
    const records = new Map<string, unknown>();
    const durable = {
      save: async (owner: string, kind: string, id: string, value: unknown) => { records.set(`${owner}:${kind}:${id}`, structuredClone(value)); },
      get: async <T>(owner: string, kind: string, id: string) => (structuredClone(records.get(`${owner}:${kind}:${id}`)) as T | undefined) ?? null,
    } as never;
    const first = new SnapshotHandleStore(1_000, 10, durable);
    const handle = first.create('7', snapshot, 10);
    await first.persist('7', handle, 10);
    expect(await new SnapshotHandleStore(1_000, 10, durable).getDurable('8', handle, 11)).toBeNull();
    expect((await new SnapshotHandleStore(1_000, 10, durable).getDurable('7', handle, 11))?.snapshotId).toBe('snapshot-1');
  });

  it('does not let the same owner use a handle from another session, including through the cache', async () => {
    const store = new SnapshotHandleStore(1_000, 10);
    const handle = store.create('7', snapshot, 10, 'session-a');

    expect(await store.getDurable('7', handle, 'session-b', 11)).toBeNull();
    expect((await store.getDurable('7', handle, 'session-a', 11))?.snapshotId).toBe('snapshot-1');
  });
});
