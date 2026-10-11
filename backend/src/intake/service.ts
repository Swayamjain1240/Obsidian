import { randomUUID } from 'node:crypto';

import { SnapshotStore } from './snapshot-store.js';
import type { RepositoryRef, SnapshotRecord } from './snapshot.js';

export interface IntakeResult {
  intakeId: string;
  snapshot: SnapshotRecord;
  analysisStatus: 'not_started';
}

export interface RepositoryArchiveSource {
  getBranchCommitSha(repository: RepositoryRef): Promise<string>;
  downloadRepositoryArchive(repository: RepositoryRef, maxBytes: number): Promise<Uint8Array>;
}

export class RepositoryIntakeService {
  constructor(private readonly snapshotStore: SnapshotStore) {}

  async createSnapshot(client: RepositoryArchiveSource, repository: RepositoryRef): Promise<IntakeResult> {
    const commitSha = repository.commitSha ?? await client.getBranchCommitSha(repository);
    const immutableRepository = { ...repository, commitSha };
    const archive = await client.downloadRepositoryArchive(immutableRepository, this.snapshotStore.getMaxBytes());
    const snapshot = await this.snapshotStore.save(immutableRepository, archive);
    return { intakeId: randomUUID(), snapshot, analysisStatus: 'not_started' };
  }
}
