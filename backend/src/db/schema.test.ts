import { describe, expect, it } from 'vitest';

import { assertSupportedSchemaVersion, persistenceSchemaVersion, validateDurableEnvelope } from './schema.js';

describe('durable schema contracts', () => {
  it('accepts the current bounded envelope and rejects future versions', () => {
    const envelope = validateDurableEnvelope({
      schemaVersion: persistenceSchemaVersion,
      revision: 1,
      ownerUserId: 'owner-1',
      stateId: 'run-1',
      phase: 'baseline',
      payload: { status: 'queued' },
      updatedAt: new Date().toISOString(),
    });
    expect(envelope.ownerUserId).toBe('owner-1');
    expect(() => assertSupportedSchemaVersion(persistenceSchemaVersion + 1)).toThrow(/Unsupported/);
  });
});
