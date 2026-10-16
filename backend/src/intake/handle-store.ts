import { randomBytes } from 'node:crypto';

import type { SnapshotRecord } from './snapshot.js';

interface SnapshotHandleRecord {
  ownerUserId: string;
  snapshot: SnapshotRecord;
  expiresAt: number;
}

export class SnapshotHandleStore {
  private readonly handles = new Map<string, SnapshotHandleRecord>();

  constructor(private readonly ttlMs = 60 * 60 * 1000, private readonly maxHandles = 10_000) {}

  create(ownerUserId: string, snapshot: SnapshotRecord, now = Date.now()): string {
    for (const [key, record] of this.handles) if (record.expiresAt <= now) this.handles.delete(key);
    while (this.handles.size >= this.maxHandles) {
      const oldest = this.handles.keys().next().value as string | undefined;
      if (!oldest) break;
      this.handles.delete(oldest);
    }
    const handle = randomBytes(32).toString('base64url');
    const ownedSnapshot: SnapshotRecord = Object.freeze({
      ...snapshot,
      repository: Object.freeze({ ...snapshot.repository }),
    });
    this.handles.set(handle, { ownerUserId, snapshot: ownedSnapshot, expiresAt: now + this.ttlMs });
    return handle;
  }

  get(ownerUserId: string, handle: string, now = Date.now()): SnapshotRecord | null {
    const record = this.handles.get(handle);
    if (!record || record.ownerUserId !== ownerUserId || record.expiresAt <= now) {
      if (record?.expiresAt && record.expiresAt <= now) this.handles.delete(handle);
      return null;
    }
    return record.snapshot;
  }
}
