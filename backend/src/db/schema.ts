import { z } from 'zod';

export const persistenceSchemaVersion = 2 as const;

export const durableEnvelopeSchema = z.object({
  schemaVersion: z.number().int().min(1),
  revision: z.number().int().min(1),
  ownerUserId: z.string().min(1).max(200),
  stateId: z.string().min(1).max(300),
  phase: z.string().min(1).max(80),
  payload: z.unknown(),
  lifecycleState: z.string().max(100).optional(),
  recovery: z.string().max(100).optional(),
  updatedAt: z.string().datetime(),
});

export type DurablePersistenceEnvelope = z.infer<typeof durableEnvelopeSchema>;

export function assertSupportedSchemaVersion(version: number): void {
  if (version !== persistenceSchemaVersion) throw new Error(`Unsupported persistence schema version ${version}.`);
}

export function validateDurableEnvelope(value: unknown): DurablePersistenceEnvelope {
  const parsed = durableEnvelopeSchema.parse(value);
  assertSupportedSchemaVersion(parsed.schemaVersion);
  return parsed;
}
