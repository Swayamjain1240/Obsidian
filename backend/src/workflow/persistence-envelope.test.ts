import { describe, expect, it } from 'vitest';

import { createPersistenceEnvelope, parsePersistenceEnvelope } from './persistence-envelope.js';

describe('workflow persistence envelopes', () => {
  it('round-trips owner, identity, revision, and bounded payload metadata', () => {
    const value = createPersistenceEnvelope({ ownerUserId: 'owner-1', stateId: 'workflow-1', phase: 'workflow', payload: { status: 'queued' } });
    expect(parsePersistenceEnvelope(value)).toMatchObject({ ownerUserId: 'owner-1', stateId: 'workflow-1', revision: 1, schemaVersion: 2 });
  });

  it('rejects an unknown future envelope version', () => {
    expect(() => parsePersistenceEnvelope({ schemaVersion: 99, revision: 1, ownerUserId: 'owner-1', stateId: 'workflow-1', phase: 'workflow', payload: {}, updatedAt: new Date().toISOString() })).toThrow(/Unsupported/);
  });
});
