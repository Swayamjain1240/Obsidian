import { randomBytes } from 'node:crypto';

import type { SnapshotRecord } from './snapshot.js';
import type { WorkflowStore } from '../workflow/store.js';

interface SnapshotHandleRecord {
  ownerUserId: string;
  sessionId?: string;
  snapshot: SnapshotRecord;
  expiresAt: number;
}

export class SnapshotHandleStore {
  private readonly handles = new Map<string, SnapshotHandleRecord>();

  constructor(private readonly ttlMs = 60 * 60 * 1000, private readonly maxHandles = 10_000, private readonly store?: WorkflowStore) {}

  create(ownerUserId: string, snapshot: SnapshotRecord, now = Date.now(), sessionId?: string): string {
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
    this.handles.set(handle, { ownerUserId, sessionId, snapshot: ownedSnapshot, expiresAt: now + this.ttlMs });
    return handle;
  }

  async persist(ownerUserId: string, handle: string, now = Date.now()): Promise<void> {
    const record = this.handles.get(handle);
    if (!record || record.ownerUserId !== ownerUserId || record.expiresAt <= now) throw new Error('Snapshot handle is invalid or expired.');
    await this.store?.save(ownerUserId, 'snapshot_handle', handle, { ownerUserId, handle, sessionId: record.sessionId, snapshot: record.snapshot, expiresAt: record.expiresAt });
  }

  get(ownerUserId: string, handle: string, now = Date.now(), sessionId?: string): SnapshotRecord | null {
    const record = this.handles.get(handle);
    if (!record || record.ownerUserId !== ownerUserId || (sessionId && record.sessionId !== sessionId) || record.expiresAt <= now) {
      if (record?.expiresAt && record.expiresAt <= now) this.handles.delete(handle);
      return null;
    }
    return record.snapshot;
  }

  async getDurable(ownerUserId: string, handle: string, sessionIdOrNow?: string | number, now = Date.now()): Promise<SnapshotRecord | null> {
    const sessionId = typeof sessionIdOrNow === 'string' ? sessionIdOrNow : undefined;
    const effectiveNow = typeof sessionIdOrNow === 'number' ? sessionIdOrNow : now;
    const cached = this.get(ownerUserId, handle, effectiveNow, sessionId);
    if (cached) return cached;
    const persisted = await this.store?.get<{ ownerUserId: string; handle: string; sessionId?: string; snapshot: SnapshotRecord; expiresAt: number }>(ownerUserId, 'snapshot_handle', handle);
    if (!persisted || persisted.ownerUserId !== ownerUserId || persisted.handle !== handle || (sessionId && persisted.sessionId !== sessionId) || persisted.expiresAt <= effectiveNow) return null;
    const ownedSnapshot: SnapshotRecord = Object.freeze({ ...persisted.snapshot, repository: Object.freeze({ ...persisted.snapshot.repository }) });
    this.handles.set(handle, { ownerUserId, sessionId: persisted.sessionId, snapshot: ownedSnapshot, expiresAt: persisted.expiresAt });
    return ownedSnapshot;
  }
}
