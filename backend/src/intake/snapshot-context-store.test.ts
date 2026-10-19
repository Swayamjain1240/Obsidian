import { describe, expect, it } from 'vitest';

import { SnapshotContextStore } from './snapshot-context-store.js';

describe('snapshot context store', () => {
  it('binds handles to an owner and expiry', () => {
    const store = new SnapshotContextStore();
    const snapshot = { snapshotId: 's', repository: { owner: 'o', name: 'r', branch: 'main' }, archivePath: 'a', manifestPath: 'm', archiveSha256: 'a'.repeat(64), byteLength: 1, capturedAt: new Date(0).toISOString(), immutable: true as const };
    store.save({ ownerUserId: '7', sessionId: 'sess', handle: 'h', snapshot, expiresAt: 100, revoked: false });
    expect(store.get('8', 'h', 1)).toBeNull();
    expect(store.get('7', 'h', 101)).toBeNull();
    expect(store.get('7', 'h', 1)?.snapshotId).toBe('s');
  });
});
