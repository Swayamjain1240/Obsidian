import { WorkflowStateModel } from '../db/models.js';
import { getDatabaseStatus } from '../db/connection.js';

function cloneValue<T>(value: T): T {
  return structuredClone(value);
}

export type WorkflowStateKind = 'workflow_aggregate' | 'repair_plan' | 'enhancement_run' | 'version_2_run' | 'validation' | 'pull_request' | 'repair_checkpoint' | 'approval_receipt' | 'recommendation_review' | 'idempotency' | 'diff' | 'repository_selection' | 'snapshot_handle' | 'delivery_step';

export interface VersionedWorkflowValue {
  revision?: number;
  updatedAt?: string;
}

export class WorkflowPersistenceError extends Error {
  public constructor(message = 'Workflow state could not be durably persisted.') {
    super(message);
    this.name = 'WorkflowPersistenceError';
  }
}

export class WorkflowRevisionConflictError extends Error {
  public constructor(public readonly expectedRevision: number, public readonly actualRevision: number) {
    super(`Workflow state revision ${actualRevision} does not match expected revision ${expectedRevision}.`);
    this.name = 'WorkflowRevisionConflictError';
  }
}

export interface WorkflowStore {
  save<T>(ownerUserId: string, kind: WorkflowStateKind, id: string, value: T): Promise<void>;
  get<T>(ownerUserId: string, kind: WorkflowStateKind, id: string): Promise<T | null>;
  getVersioned<T extends VersionedWorkflowValue>(ownerUserId: string, kind: WorkflowStateKind, id: string): Promise<T | null>;
  saveVersioned<T extends VersionedWorkflowValue>(ownerUserId: string, kind: WorkflowStateKind, id: string, value: T, expectedRevision?: number): Promise<T>;
  assertWritable?(): void;
}

/**
 * Memory is kept as a fast read-through cache, while every write is also sent
 * to MongoDB. In development/test mode a disconnected database may use the
 * bounded cache; required production writes fail before an unpersisted value
 * replaces the authoritative cache.
 */
export class DurableWorkflowStore implements WorkflowStore {
  private readonly cache = new Map<string, unknown>();
  private readonly persistenceErrors: Error[] = [];

  public constructor(private readonly requirePersistence = false) {}

  public assertWritable(): void {
    if (this.requirePersistence && getDatabaseStatus() !== 'connected') throw new WorkflowPersistenceError();
  }

  public async save<T>(ownerUserId: string, kind: WorkflowStateKind, id: string, value: T): Promise<void> {
    this.assertWritable();
    const key = `${ownerUserId}:${kind}:${id}`;
    const cloned = cloneValue(value);
    if (getDatabaseStatus() !== 'connected') {
      this.cache.set(key, cloned);
      return;
    }
    try {
      await WorkflowStateModel.updateOne(
        { ownerUserId, kind, stateId: id },
        { $set: { ownerUserId, kind, stateId: id, payload: value, updatedAt: new Date() } },
        { upsert: true },
      ).exec();
      this.cache.set(key, cloned);
    } catch (reason: unknown) {
      this.persistenceErrors.push(reason instanceof Error ? reason : new Error('Workflow persistence failed.'));
      if (this.requirePersistence) throw new WorkflowPersistenceError(reason instanceof Error ? reason.message : undefined);
      this.cache.set(key, cloned);
    }
  }

  public async getVersioned<T extends VersionedWorkflowValue>(ownerUserId: string, kind: WorkflowStateKind, id: string): Promise<T | null> {
    return this.get<T>(ownerUserId, kind, id);
  }

  public async saveVersioned<T extends VersionedWorkflowValue>(ownerUserId: string, kind: WorkflowStateKind, id: string, value: T, expectedRevision?: number): Promise<T> {
    this.assertWritable();
    const current = await this.get<T>(ownerUserId, kind, id);
    const actualRevision = Number.isSafeInteger(current?.revision) ? current!.revision! : 0;
    if (expectedRevision !== undefined && expectedRevision !== actualRevision) throw new WorkflowRevisionConflictError(expectedRevision, actualRevision);
    const next = { ...value, revision: actualRevision + 1, updatedAt: new Date().toISOString() } as T;
    const key = `${ownerUserId}:${kind}:${id}`;
    if (getDatabaseStatus() !== 'connected') {
      const latest = this.cache.get(key) as T | undefined;
      const latestRevision = Number.isSafeInteger(latest?.revision) ? latest!.revision! : 0;
      if (current && latestRevision !== actualRevision) throw new WorkflowRevisionConflictError(expectedRevision ?? actualRevision, latestRevision);
      this.cache.set(key, cloneValue(next));
      if (this.requirePersistence) throw new WorkflowPersistenceError();
      return next;
    }
    try {
      const filter: Record<string, unknown> = { ownerUserId, kind, stateId: id };
      if (current) filter.revision = actualRevision;
      const updated = await WorkflowStateModel.findOneAndUpdate(
        filter,
        { $set: { ownerUserId, kind, stateId: id, revision: next.revision, payload: next, updatedAt: new Date() } },
        { upsert: !current, new: true, setDefaultsOnInsert: true },
      ).lean().exec();
      if (!updated) throw new WorkflowRevisionConflictError(expectedRevision ?? actualRevision, actualRevision);
      this.cache.set(key, cloneValue(next));
      return next;
    } catch (reason: unknown) {
      if (reason instanceof WorkflowRevisionConflictError) throw reason;
      throw new WorkflowPersistenceError(reason instanceof Error ? reason.message : undefined);
    }
  }

  public async get<T>(ownerUserId: string, kind: WorkflowStateKind, id: string): Promise<T | null> {
    const key = `${ownerUserId}:${kind}:${id}`;
    const cached = this.cache.get(key);
    if (cached) return cloneValue(cached as T);
    if (getDatabaseStatus() !== 'connected') {
      if (this.requirePersistence) throw new WorkflowPersistenceError();
      return null;
    }
    try {
      const record = await WorkflowStateModel.findOne({ ownerUserId, kind, stateId: id }).lean().exec();
      if (!record) return null;
      this.cache.set(key, cloneValue(record.payload));
      return cloneValue(record.payload as T);
    } catch (reason: unknown) {
      this.persistenceErrors.push(reason instanceof Error ? reason : new Error('Workflow persistence failed.'));
      if (this.requirePersistence) throw new WorkflowPersistenceError(reason instanceof Error ? reason.message : undefined);
      return null;
    }
  }

  public persistenceHealth(): { pendingErrors: number } {
    return { pendingErrors: this.persistenceErrors.length };
  }
}
