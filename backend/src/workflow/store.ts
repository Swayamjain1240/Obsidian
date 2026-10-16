import { WorkflowStateModel } from '../db/models.js';
import { getDatabaseStatus } from '../db/connection.js';

export type WorkflowStateKind = 'repair_plan' | 'enhancement_run' | 'version_2_run' | 'validation' | 'pull_request';

export interface WorkflowStore {
  save<T>(ownerUserId: string, kind: WorkflowStateKind, id: string, value: T): Promise<void>;
  get<T>(ownerUserId: string, kind: WorkflowStateKind, id: string): Promise<T | null>;
}

/**
 * Memory is kept as a fast read-through cache, while every write is also sent
 * to MongoDB. A disconnected database never turns an approved workflow into a
 * false success: the caller receives the in-memory state and the persistence
 * error is retained for the health/event layer to report.
 */
export class DurableWorkflowStore implements WorkflowStore {
  private readonly cache = new Map<string, unknown>();
  private readonly persistenceErrors: Error[] = [];

  public async save<T>(ownerUserId: string, kind: WorkflowStateKind, id: string, value: T): Promise<void> {
    const key = `${ownerUserId}:${kind}:${id}`;
    this.cache.set(key, value);
    if (getDatabaseStatus() !== 'connected') return;
    try {
      await WorkflowStateModel.updateOne(
        { ownerUserId, kind, stateId: id },
        { $set: { ownerUserId, kind, stateId: id, payload: value, updatedAt: new Date() } },
        { upsert: true },
      ).exec();
    } catch (reason: unknown) {
      this.persistenceErrors.push(reason instanceof Error ? reason : new Error('Workflow persistence failed.'));
    }
  }

  public async get<T>(ownerUserId: string, kind: WorkflowStateKind, id: string): Promise<T | null> {
    const key = `${ownerUserId}:${kind}:${id}`;
    const cached = this.cache.get(key);
    if (cached) return cached as T;
    if (getDatabaseStatus() !== 'connected') return null;
    try {
      const record = await WorkflowStateModel.findOne({ ownerUserId, kind, stateId: id }).lean().exec();
      if (!record) return null;
      this.cache.set(key, record.payload);
      return record.payload as T;
    } catch (reason: unknown) {
      this.persistenceErrors.push(reason instanceof Error ? reason : new Error('Workflow persistence failed.'));
      return null;
    }
  }

  public persistenceHealth(): { pendingErrors: number } {
    return { pendingErrors: this.persistenceErrors.length };
  }
}
