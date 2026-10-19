import type { SnapshotRecord } from './snapshot.js';

export interface SnapshotContextRecord {
  ownerUserId: string;
  sessionId: string;
  handle: string;
  snapshot: SnapshotRecord;
  expiresAt: number;
  revoked: boolean;
}

export class SnapshotContextStore {
  private readonly records = new Map<string, SnapshotContextRecord>();

  public save(record: SnapshotContextRecord): void {
    this.records.set(record.handle, { ...record, snapshot: { ...record.snapshot, repository: { ...record.snapshot.repository } } });
  }

  public get(ownerUserId: string, handle: string, now = Date.now()): SnapshotRecord | null {
    const record = this.records.get(handle);
    if (!record || record.ownerUserId !== ownerUserId || record.revoked || record.expiresAt <= now) return null;
    return { ...record.snapshot, repository: { ...record.snapshot.repository } };
  }

  public revoke(ownerUserId: string, handle: string): boolean {
    const record = this.records.get(handle);
    if (!record || record.ownerUserId !== ownerUserId) return false;
    record.revoked = true;
    return true;
  }
}
