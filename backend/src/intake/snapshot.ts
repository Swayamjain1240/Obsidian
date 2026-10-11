import { createHash } from 'node:crypto';

export interface RepositoryRef {
  owner: string;
  name: string;
  branch: string;
  commitSha?: string;
}

export interface SnapshotRecord {
  snapshotId: string;
  repository: RepositoryRef;
  archivePath: string;
  manifestPath: string;
  archiveSha256: string;
  byteLength: number;
  capturedAt: string;
  immutable: true;
}

export function sha256(buffer: Uint8Array): string {
  return createHash('sha256').update(buffer).digest('hex');
}

export function createSnapshotId(repository: RepositoryRef, archiveSha256: string): string {
  return createHash('sha256')
    .update(`${repository.owner}/${repository.name}@${repository.commitSha ?? repository.branch}:${archiveSha256}`)
    .digest('hex')
    .slice(0, 32);
}
