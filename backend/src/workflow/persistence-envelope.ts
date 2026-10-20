import { persistenceSchemaVersion, validateDurableEnvelope, type DurablePersistenceEnvelope } from '../db/schema.js';

export interface WorkflowPersistenceEnvelope<T = unknown> extends DurablePersistenceEnvelope {
  payload: T;
}

export function createPersistenceEnvelope<T>(input: {
  ownerUserId: string;
  stateId: string;
  phase: string;
  payload: T;
  revision?: number;
  lifecycleState?: string;
  recovery?: string;
  updatedAt?: string;
}): WorkflowPersistenceEnvelope<T> {
  return {
    schemaVersion: persistenceSchemaVersion,
    revision: input.revision ?? 1,
    ownerUserId: input.ownerUserId,
    stateId: input.stateId,
    phase: input.phase,
    payload: input.payload,
    lifecycleState: input.lifecycleState,
    recovery: input.recovery,
    updatedAt: input.updatedAt ?? new Date().toISOString(),
  };
}

export function parsePersistenceEnvelope<T>(value: unknown): WorkflowPersistenceEnvelope<T> {
  return validateDurableEnvelope(value) as WorkflowPersistenceEnvelope<T>;
}
