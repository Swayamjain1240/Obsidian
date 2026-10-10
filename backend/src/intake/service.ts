import { randomUUID } from 'node:crypto';

import { SnapshotStore } from './snapshot-store.js';
import type { RepositoryRef, SnapshotRecord } from './snapshot.js';

export interface IntakeResult {
  intakeId: string;
  snapshot: SnapshotRecord;
  analysisStatus: 'not_started';
}

export interface RepositoryArchiveSource {
  downloadRepositoryArchive(repository: RepositoryRef, maxBytes: number): Promise<Uint8Array>;
}

export class RepositoryIntakeService {
  constructor(private readonly snapshotStore: SnapshotStore) {}

  async createSnapshot(client: RepositoryArchiveSource, repository: RepositoryRef): Promise<IntakeResult> {
    const archive = await client.downloadRepositoryArchive(repository, this.snapshotStore.getMaxBytes());
    const snapshot = await this.snapshotStore.save(repository, archive);
    return { intakeId: randomUUID(), snapshot, analysisStatus: 'not_started' };
  }
}
