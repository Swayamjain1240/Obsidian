import { DurableRunStateModel } from '../db/models.js';
import { getDatabaseStatus } from '../db/connection.js';

function cloneValue<T>(value: T): T { return structuredClone(value); }

export type DurableRunPhase = 'detection' | 'completeness' | 'baseline';

export interface DurableRunEnvelope<T, C = unknown> {
  version: 1;
  ownerUserId: string;
  runId: string;
  phase: DurableRunPhase;
  result: T;
  context?: C;
  lifecycleState?: string;
  recovery?: string;
  updatedAt: string;
}

export class DurableRunPersistenceError extends Error {
  public constructor(message = 'Run state could not be durably persisted.') {
    super(message);
    this.name = 'DurableRunPersistenceError';
  }
}

export class DurableRunStore {
  private readonly cache = new Map<string, unknown>();

  public constructor(private readonly requirePersistence = false) {}

  public assertWritable(): void {
    if (this.requirePersistence && getDatabaseStatus() !== 'connected') throw new DurableRunPersistenceError();
  }

  public async save<T>(ownerUserId: string, runId: string, phase: DurableRunPhase, payload: T): Promise<void> {
    this.assertWritable();
    const key = `${ownerUserId}:${runId}`;
    const cloned = cloneValue(payload);
    if (getDatabaseStatus() !== 'connected') {
      this.cache.set(key, cloned);
      return;
    }
    try {
      await DurableRunStateModel.updateOne({ ownerUserId, runId }, { $set: { ownerUserId, runId, phase, payload, updatedAt: new Date() } }, { upsert: true }).exec();
      this.cache.set(key, cloned);
    } catch (reason) {
      // The caller retains a bounded in-memory copy; readiness reports database health.
      if (this.requirePersistence) throw reason instanceof DurableRunPersistenceError ? reason : new DurableRunPersistenceError(reason instanceof Error ? reason.message : undefined);
      this.cache.set(key, cloned);
    }
  }

  public async get<T>(ownerUserId: string, runId: string): Promise<T | null> {
    const key = `${ownerUserId}:${runId}`;
    const cached = this.cache.get(key);
    if (cached) return cloneValue(cached as T);
    if (getDatabaseStatus() !== 'connected') {
      if (this.requirePersistence) throw new DurableRunPersistenceError();
      return null;
    }
    try {
      const record = await DurableRunStateModel.findOne({ ownerUserId, runId }).lean().exec();
      if (!record) return null;
      this.cache.set(key, cloneValue(record.payload));
      return cloneValue(record.payload as T);
    } catch (reason) {
      if (this.requirePersistence) throw reason instanceof DurableRunPersistenceError ? reason : new DurableRunPersistenceError(reason instanceof Error ? reason.message : undefined);
      return null;
    }
  }

  public async saveEnvelope<T, C>(ownerUserId: string, runId: string, phase: DurableRunPhase, envelope: DurableRunEnvelope<T, C>): Promise<void> {
    await this.save(ownerUserId, runId, phase, envelope);
  }

  public async getEnvelope<T, C>(ownerUserId: string, runId: string): Promise<DurableRunEnvelope<T, C> | null> {
    const value = await this.get<DurableRunEnvelope<T, C> | T>(ownerUserId, runId);
    if (!value) return null;
    if (typeof value === 'object' && value !== null && 'result' in value && 'version' in value) return value as DurableRunEnvelope<T, C>;
    return null;
  }
}
