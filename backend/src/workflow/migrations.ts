import { persistenceSchemaVersion } from '../db/schema.js';

export interface MigrationResult<T> {
  value: T;
  migrated: boolean;
  fromVersion: number;
  toVersion: number;
}

export function migratePersistenceEnvelope<T extends Record<string, unknown>>(value: T): MigrationResult<T & { schemaVersion: number }> {
  const fromVersion = typeof value.schemaVersion === 'number' ? value.schemaVersion : 1;
  if (fromVersion > persistenceSchemaVersion) throw new Error(`Unsupported persistence schema version ${fromVersion}.`);
  if (fromVersion === persistenceSchemaVersion) return { value: value as T & { schemaVersion: number }, migrated: false, fromVersion, toVersion: fromVersion };
  return {
    value: { ...value, schemaVersion: persistenceSchemaVersion } as T & { schemaVersion: number },
    migrated: true,
    fromVersion,
    toVersion: persistenceSchemaVersion,
  };
}
