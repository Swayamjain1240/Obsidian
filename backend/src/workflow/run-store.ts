import { DurableRunStateModel } from '../db/models.js';
import { getDatabaseGeneration, getDatabaseStatus } from '../db/connection.js';
import { isDuplicateKeyError, revisionOf } from '../db/cas.js';

function cloneValue<T>(value: T): T { return structuredClone(value); }

export type DurableRunPhase = 'detection' | 'completeness' | 'baseline';

export interface DurableRunEnvelope<T, C = unknown> {
  version: 1;
  schemaVersion?: number;
  revision?: number;
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
  private cacheGeneration = getDatabaseGeneration();

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
    const generation = getDatabaseGeneration();
    if (generation !== this.cacheGeneration) {
      this.cache.clear();
      this.cacheGeneration = generation;
    }
    if (getDatabaseStatus() !== 'connected') {
      if (this.requirePersistence) throw new DurableRunPersistenceError();
      const cached = this.cache.get(key);
      return cached ? cloneValue(cached as T) : null;
    }
    try {
      const record = await DurableRunStateModel.findOne({ ownerUserId, runId }).read('primary').lean().exec();
      if (!record) return null;
      this.cache.set(key, cloneValue(record.payload));
      return cloneValue(record.payload as T);
    } catch (reason) {
      if (this.requirePersistence) throw reason instanceof DurableRunPersistenceError ? reason : new DurableRunPersistenceError(reason instanceof Error ? reason.message : undefined);
      return null;
    }
  }

  public async saveEnvelope<T, C>(ownerUserId: string, runId: string, phase: DurableRunPhase, envelope: DurableRunEnvelope<T, C>): Promise<DurableRunEnvelope<T, C>> {
    this.assertWritable();
    const current = await this.getEnvelope<T, C>(ownerUserId, runId);
    const currentRevision = revisionOf(current);
    const next: DurableRunEnvelope<T, C> = {
      ...envelope,
      schemaVersion: 2,
      revision: currentRevision + 1,
      ownerUserId,
      runId,
      phase,
      updatedAt: new Date().toISOString(),
    };
    const key = `${ownerUserId}:${runId}`;
    if (getDatabaseStatus() !== 'connected') {
      this.cache.set(key, cloneValue(next));
      if (this.requirePersistence) throw new DurableRunPersistenceError();
      return next;
    }
    try {
      const filter: Record<string, unknown> = { ownerUserId, runId };
      if (current) filter.revision = currentRevision;
      const updated = await DurableRunStateModel.findOneAndUpdate(
        filter,
        { $set: { ownerUserId, runId, phase, schemaVersion: 2, revision: next.revision, lifecycleState: next.lifecycleState ?? null, recovery: next.recovery ?? null, payload: next, updatedAt: new Date() } },
        { upsert: !current, new: true, setDefaultsOnInsert: true, writeConcern: { w: 'majority', j: true } },
      ).lean().exec();
      if (!updated) throw new DurableRunPersistenceError('Run state revision changed before it could be persisted.');
      this.cache.set(key, cloneValue(next));
      return next;
    } catch (reason: unknown) {
      if (reason instanceof DurableRunPersistenceError) throw reason;
      if (isDuplicateKeyError(reason)) throw new DurableRunPersistenceError('Run state revision changed before it could be persisted.');
      throw new DurableRunPersistenceError(reason instanceof Error ? reason.message : undefined);
    }
  }

  public async getEnvelope<T, C>(ownerUserId: string, runId: string): Promise<DurableRunEnvelope<T, C> | null> {
    const value = await this.get<DurableRunEnvelope<T, C> | T>(ownerUserId, runId);
    if (!value) return null;
    if (typeof value === 'object' && value !== null && 'result' in value && 'version' in value) {
      const envelope = value as DurableRunEnvelope<T, C>;
      return { ...envelope, schemaVersion: envelope.schemaVersion ?? 1, revision: envelope.revision ?? 1 };
    }
    return null;
  }
}
