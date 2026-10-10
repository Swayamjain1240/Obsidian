import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { RepositoryIntakeService } from './service.js';
import { SnapshotStore } from './snapshot-store.js';

describe('repository intake service', () => {
  it('creates a snapshot and does not start analysis', async () => {
    const client = { downloadRepositoryArchive: vi.fn().mockResolvedValue(new TextEncoder().encode('archive')) };
    const root = await mkdtemp(path.join(os.tmpdir(), 'obsidian-intake-'));
    try {
      const store = new SnapshotStore(root, 1024);
      const result = await new RepositoryIntakeService(store).createSnapshot(client, {
        owner: 'owner',
        name: 'repo',
        branch: 'main',
      });

      expect(result.intakeId).toBeTruthy();
      expect(result.analysisStatus).toBe('not_started');
      expect(client.downloadRepositoryArchive).toHaveBeenCalledWith(
        { owner: 'owner', name: 'repo', branch: 'main' },
        1024,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
