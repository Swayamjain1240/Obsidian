import { describe, expect, it } from 'vitest';

import { migratePersistenceEnvelope } from './migrations.js';

describe('persistence migrations', () => {
  it('upgrades a legacy envelope metadata version without changing payload', () => {
    const result = migratePersistenceEnvelope({ schemaVersion: 1, ownerUserId: 'owner-1', payload: { status: 'passed' } });
    expect(result.migrated).toBe(true);
    expect(result.value.schemaVersion).toBe(2);
    expect(result.value.payload).toEqual({ status: 'passed' });
  });

  it('fails closed for an unknown future version', () => {
    expect(() => migratePersistenceEnvelope({ schemaVersion: 99 })).toThrow(/Unsupported/);
  });
});
