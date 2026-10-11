import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { createSnapshotId, sha256, type RepositoryRef, type SnapshotRecord } from './snapshot.js';

export class SnapshotStore {
  constructor(private readonly root: string, private readonly maxBytes: number) {}

  getMaxBytes(): number {
    return this.maxBytes;
  }

  async save(repository: RepositoryRef, archive: Uint8Array): Promise<SnapshotRecord> {
    if (archive.byteLength > this.maxBytes) {
      throw new Error('Repository snapshot exceeds the configured size limit.');
    }

    const archiveSha256 = sha256(archive);
    const snapshotId = createSnapshotId(repository, archiveSha256);
    const directory = path.resolve(this.root, snapshotId);
    const archivePath = path.join(directory, 'repository.tar.gz');
    const manifestPath = path.join(directory, 'snapshot.json');
    await mkdir(directory, { recursive: true });
    await writeFile(archivePath, archive, { flag: 'wx' }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') throw error;
    });

    const record: SnapshotRecord = {
      snapshotId,
      repository,
      archivePath,
      manifestPath,
      archiveSha256,
      byteLength: archive.byteLength,
      capturedAt: new Date().toISOString(),
      immutable: true,
    };

    await writeFile(manifestPath, JSON.stringify(record, null, 2), { flag: 'wx' }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') throw error;
    });

    return record;
  }
}
