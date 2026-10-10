import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { SnapshotStore } from './snapshot-store.js';

describe('snapshot store', () => {
  it('writes a content-addressed archive once and marks it immutable', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'obsidian-snapshot-'));
    try {
      const store = new SnapshotStore(root, 1024);
      const repository = { owner: 'owner', name: 'repo', branch: 'main' };
      const first = await store.save(repository, new TextEncoder().encode('archive'));
      const second = await store.save(repository, new TextEncoder().encode('archive'));

      expect(first.snapshotId).toBe(second.snapshotId);
      expect(first.immutable).toBe(true);
      expect(new TextDecoder().decode(await readFile(first.archivePath))).toBe('archive');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects archives over the configured size limit', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'obsidian-snapshot-'));
    try {
      await expect(new SnapshotStore(root, 2).save({ owner: 'o', name: 'r', branch: 'main' }, new Uint8Array(3))).rejects.toThrow(/size limit/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
