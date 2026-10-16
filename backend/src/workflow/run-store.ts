import { DurableRunStateModel } from '../db/models.js';
import { getDatabaseStatus } from '../db/connection.js';

export type DurableRunPhase = 'detection' | 'completeness' | 'baseline';

export class DurableRunStore {
  private readonly cache = new Map<string, unknown>();

  public async save<T>(ownerUserId: string, runId: string, phase: DurableRunPhase, payload: T): Promise<void> {
    const key = `${ownerUserId}:${runId}`;
    this.cache.set(key, payload);
    if (getDatabaseStatus() !== 'connected') return;
    try {
      await DurableRunStateModel.updateOne({ ownerUserId, runId }, { $set: { ownerUserId, runId, phase, payload, updatedAt: new Date() } }, { upsert: true }).exec();
    } catch {
      // The caller retains a bounded in-memory copy; readiness reports database health.
    }
  }

  public async get<T>(ownerUserId: string, runId: string): Promise<T | null> {
    const key = `${ownerUserId}:${runId}`;
    const cached = this.cache.get(key);
    if (cached) return cached as T;
    if (getDatabaseStatus() !== 'connected') return null;
    try {
      const record = await DurableRunStateModel.findOne({ ownerUserId, runId }).lean().exec();
      if (!record) return null;
      this.cache.set(key, record.payload);
      return record.payload as T;
    } catch {
      return null;
    }
  }
}
