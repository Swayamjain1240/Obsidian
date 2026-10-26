import { WorkflowStateModel } from '../db/models.js';
import { getDatabaseGeneration, getDatabaseStatus } from '../db/connection.js';
import { isDuplicateKeyError, DatabaseRevisionConflictError, revisionOf } from '../db/cas.js';
import { withMongoTransaction } from '../db/transactions.js';

function cloneValue<T>(value: T): T {
  return structuredClone(value);
}

export type WorkflowStateKind = 'workflow_aggregate' | 'repair_plan' | 'enhancement_run' | 'version_2_run' | 'validation' | 'pull_request' | 'repair_checkpoint' | 'approval_receipt' | 'recommendation_review' | 'idempotency' | 'diff' | 'repository_selection' | 'snapshot_handle' | 'delivery_step' | 'deletion_request' | 'privacy_cleanup';

export interface VersionedWorkflowValue {
  schemaVersion?: number;
  revision?: number;
  updatedAt?: string;
}

export interface WorkflowPageCursor {
  dueAt: number;
  createdAt: string;
  id: string;
}

export interface WorkflowPage<T> {
  entries: Array<{ id: string; value: T }>;
  nextCursor?: WorkflowPageCursor;
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
  list?<T>(ownerUserId: string, kind: WorkflowStateKind): Promise<Array<{ id: string; value: T }>>;
  listAll?<T>(kind: WorkflowStateKind): Promise<Array<{ ownerUserId: string; id: string; value: T }>>;
  listCleanupTasksPage<T>(ownerUserId: string, dueAt: number, limit: number, cursor?: WorkflowPageCursor): Promise<WorkflowPage<T>>;
  listCleanupTaskOwners(dueAt: number): Promise<string[]>;
  delete?(ownerUserId: string, kind: WorkflowStateKind, id: string): Promise<void>;
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
  private cacheGeneration = getDatabaseGeneration();

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
        { $set: { ownerUserId, kind, stateId: id, schemaVersion: 2, payload: value, updatedAt: new Date() } },
        { upsert: true, writeConcern: { w: 'majority', j: true } },
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
    const actualRevision = revisionOf(current);
    if (expectedRevision !== undefined && expectedRevision !== actualRevision) throw new WorkflowRevisionConflictError(expectedRevision, actualRevision);
    const next = { ...value, schemaVersion: 2, revision: actualRevision + 1, updatedAt: new Date().toISOString() } as T;
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
        { $set: { ownerUserId, kind, stateId: id, schemaVersion: 2, revision: next.revision, payload: next, updatedAt: new Date() } },
        { upsert: !current, new: true, setDefaultsOnInsert: true, writeConcern: { w: 'majority', j: true } },
      ).lean().exec();
      if (!updated) throw new WorkflowRevisionConflictError(expectedRevision ?? actualRevision, actualRevision);
      this.cache.set(key, cloneValue(next));
      return next;
    } catch (reason: unknown) {
      if (reason instanceof WorkflowRevisionConflictError) throw reason;
      if (reason instanceof DatabaseRevisionConflictError || isDuplicateKeyError(reason)) {
        throw new WorkflowRevisionConflictError(expectedRevision ?? actualRevision, actualRevision + 1);
      }
      throw new WorkflowPersistenceError(reason instanceof Error ? reason.message : undefined);
    }
  }

  public async saveVersionedPair<T extends VersionedWorkflowValue, U extends VersionedWorkflowValue>(
    ownerUserId: string,
    primary: { kind: WorkflowStateKind; id: string; value: T },
    secondary: { kind: WorkflowStateKind; id: string; value: U },
  ): Promise<{ primary: T; secondary: U }> {
    this.assertWritable();
    return withMongoTransaction(async (session) => {
      const saveOne = async <V extends VersionedWorkflowValue>(entry: { kind: WorkflowStateKind; id: string; value: V }): Promise<V> => {
        const current = await WorkflowStateModel.findOne({ ownerUserId, kind: entry.kind, stateId: entry.id }).session(session).lean().exec();
        const actualRevision = Number.isSafeInteger(current?.revision) ? Number(current?.revision) : 0;
        const requestedRevision = revisionOf(entry.value);
        if (requestedRevision > 1 && requestedRevision - 1 !== actualRevision) throw new WorkflowRevisionConflictError(requestedRevision - 1, actualRevision);
        const next = { ...entry.value, schemaVersion: 2, revision: actualRevision + 1, updatedAt: new Date().toISOString() } as V;
        const filter: Record<string, unknown> = { ownerUserId, kind: entry.kind, stateId: entry.id };
        if (current) filter.revision = actualRevision;
        const updated = await WorkflowStateModel.findOneAndUpdate(
          filter,
          { $set: { ownerUserId, kind: entry.kind, stateId: entry.id, schemaVersion: 2, revision: next.revision, payload: next, updatedAt: new Date() } },
          { upsert: !current, new: true, setDefaultsOnInsert: true, session, writeConcern: { w: 'majority', j: true } },
        ).lean().exec();
        if (!updated) throw new WorkflowRevisionConflictError(actualRevision, actualRevision);
        return next;
      };
      return { primary: await saveOne(primary), secondary: await saveOne(secondary) };
    });
  }

  public async get<T>(ownerUserId: string, kind: WorkflowStateKind, id: string): Promise<T | null> {
    const key = `${ownerUserId}:${kind}:${id}`;
    const generation = getDatabaseGeneration();
    if (generation !== this.cacheGeneration) {
      this.cache.clear();
      this.cacheGeneration = generation;
    }
    if (getDatabaseStatus() !== 'connected') {
      if (this.requirePersistence) throw new WorkflowPersistenceError();
      const cached = this.cache.get(key);
      return cached ? cloneValue(cached as T) : null;
    }
    try {
      const record = await WorkflowStateModel.findOne({ ownerUserId, kind, stateId: id }).read('primary').lean().exec();
      if (!record) return null;
      this.cache.set(key, cloneValue(record.payload));
      return cloneValue(record.payload as T);
    } catch (reason: unknown) {
      this.persistenceErrors.push(reason instanceof Error ? reason : new Error('Workflow persistence failed.'));
      if (this.requirePersistence) throw new WorkflowPersistenceError(reason instanceof Error ? reason.message : undefined);
      return null;
    }
  }

  public async list<T>(ownerUserId: string, kind: WorkflowStateKind): Promise<Array<{ id: string; value: T }>> {
    if (getDatabaseStatus() !== 'connected') {
      if (this.requirePersistence) throw new WorkflowPersistenceError();
      const prefix = `${ownerUserId}:${kind}:`;
      return [...this.cache.entries()]
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, value]) => ({ id: key.slice(prefix.length), value: cloneValue(value as T) }));
    }
    try {
      const records = await WorkflowStateModel.find({ ownerUserId, kind }).read('primary').lean().exec();
      return records.map((record) => ({ id: String(record.stateId), value: cloneValue(record.payload as T) }));
    } catch (reason: unknown) {
      if (this.requirePersistence) throw new WorkflowPersistenceError(reason instanceof Error ? reason.message : undefined);
      return [];
    }
  }

  public async listAll<T>(kind: WorkflowStateKind): Promise<Array<{ ownerUserId: string; id: string; value: T }>> {
    if (getDatabaseStatus() !== 'connected') {
      if (this.requirePersistence) throw new WorkflowPersistenceError();
      return [...this.cache.entries()]
        .filter(([key]) => key.split(':')[1] === kind)
        .map(([key, value]) => {
          const parts = key.split(':');
          return { ownerUserId: parts[0], id: parts.slice(2).join(':'), value: cloneValue(value as T) };
        });
    }
    try {
      const records = await WorkflowStateModel.find({ kind }).read('primary').lean().exec();
      return records.map((record) => ({ ownerUserId: String(record.ownerUserId), id: String(record.stateId), value: cloneValue(record.payload as T) }));
    } catch (reason: unknown) {
      if (this.requirePersistence) throw new WorkflowPersistenceError(reason instanceof Error ? reason.message : undefined);
      return [];
    }
  }

  public async listCleanupTasksPage<T>(ownerUserId: string, dueAt: number, limit: number, cursor?: WorkflowPageCursor): Promise<WorkflowPage<T>> {
    const boundedLimit = Math.max(1, Math.min(1_000, Math.floor(limit)));
    if (getDatabaseStatus() !== 'connected') {
      if (this.requirePersistence) throw new WorkflowPersistenceError();
      const prefix = `${ownerUserId}:privacy_cleanup:`;
      const records = [...this.cache.entries()]
        .filter(([key, value]) => {
          const task = value as { dueAt?: unknown; status?: unknown; nextAttemptAt?: unknown; claimExpiresAt?: unknown };
          const retryDue = task.nextAttemptAt === undefined || Number(task.nextAttemptAt) <= dueAt;
          const claimDue = task.status !== 'running' || task.claimExpiresAt === undefined || Number(task.claimExpiresAt) <= dueAt;
          return key.startsWith(prefix) && Number(task.dueAt) <= dueAt && task.status !== 'completed' && retryDue && claimDue;
        })
        .map(([key, value]) => ({ id: key.slice(prefix.length), value: cloneValue(value as T) }))
        .sort((left, right) => {
          const leftValue = left.value as T & { dueAt: number; createdAt: string };
          const rightValue = right.value as T & { dueAt: number; createdAt: string };
          return leftValue.dueAt - rightValue.dueAt || leftValue.createdAt.localeCompare(rightValue.createdAt) || left.id.localeCompare(right.id);
        });
      const afterCursor = cursor ? records.findIndex((entry) => {
        const value = entry.value as T & { dueAt: number; createdAt: string };
        return value.dueAt > cursor.dueAt || (value.dueAt === cursor.dueAt && (value.createdAt > cursor.createdAt || (value.createdAt === cursor.createdAt && entry.id > cursor.id)));
      }) : 0;
      const start = afterCursor < 0 ? records.length : afterCursor;
      const page = records.slice(start, start + boundedLimit);
      const last = page.at(-1);
      const hasMore = start + page.length < records.length;
      return {
        entries: page,
        nextCursor: hasMore && last ? { dueAt: Number((last.value as { dueAt: number }).dueAt), createdAt: String((last.value as { createdAt: string }).createdAt), id: last.id } : undefined,
      };
    }
    try {
      const conditions: Array<Record<string, unknown>> = [
        { 'payload.dueAt': { $lte: dueAt } },
        { 'payload.status': { $ne: 'completed' } },
        { $or: [
          { 'payload.nextAttemptAt': { $exists: false } },
          { 'payload.nextAttemptAt': { $lte: dueAt } },
        ] },
        { $or: [
          { 'payload.status': { $in: ['scheduled', 'failed'] } },
          { 'payload.status': 'running', 'payload.claimExpiresAt': { $lte: dueAt } },
        ] },
      ];
      if (cursor) {
        conditions.push({ $or: [
          { 'payload.dueAt': { $gt: cursor.dueAt, $lte: dueAt } },
          { 'payload.dueAt': cursor.dueAt, 'payload.createdAt': { $gt: cursor.createdAt } },
          { 'payload.dueAt': cursor.dueAt, 'payload.createdAt': cursor.createdAt, stateId: { $gt: cursor.id } },
        ] });
      }
      const filter: Record<string, unknown> = { ownerUserId, kind: 'privacy_cleanup', $and: conditions };
      const records = await WorkflowStateModel.find(filter)
        .sort({ 'payload.dueAt': 1, 'payload.createdAt': 1, stateId: 1 })
        .limit(boundedLimit)
        .read('primary')
        .lean()
        .exec();
      const pageRecords = records.map((record) => ({ id: String(record.stateId), value: cloneValue(record.payload as T) }));
      return {
        entries: pageRecords,
        nextCursor: undefined,
      };
    } catch (reason: unknown) {
      if (this.requirePersistence) throw new WorkflowPersistenceError(reason instanceof Error ? reason.message : undefined);
      return { entries: [] };
    }
  }

  public async listCleanupTaskOwners(dueAt: number): Promise<string[]> {
    if (getDatabaseStatus() !== 'connected') {
      if (this.requirePersistence) throw new WorkflowPersistenceError();
      const owners = new Set<string>();
      for (const [key, value] of this.cache.entries()) {
        if (!key.includes(':privacy_cleanup:')) continue;
        const task = value as { dueAt?: unknown; status?: unknown; nextAttemptAt?: unknown; claimExpiresAt?: unknown };
        const retryDue = task.nextAttemptAt === undefined || Number(task.nextAttemptAt) <= dueAt;
        const claimDue = task.status !== 'running' || task.claimExpiresAt === undefined || Number(task.claimExpiresAt) <= dueAt;
        if (Number(task.dueAt) <= dueAt && task.status !== 'completed' && retryDue && claimDue) owners.add(key.split(':')[0]);
      }
      return [...owners];
    }
    try {
      return (await WorkflowStateModel.distinct('ownerUserId', {
        kind: 'privacy_cleanup',
        'payload.dueAt': { $lte: dueAt },
        'payload.status': { $ne: 'completed' },
        $or: [
          { 'payload.nextAttemptAt': { $exists: false } },
          { 'payload.nextAttemptAt': { $lte: dueAt } },
        ],
        $and: [{
          $or: [
            { 'payload.status': { $in: ['scheduled', 'failed'] } },
            { 'payload.status': 'running', 'payload.claimExpiresAt': { $lte: dueAt } },
          ],
        }],
      }).exec()).map(String);
    } catch (reason: unknown) {
      if (this.requirePersistence) throw new WorkflowPersistenceError(reason instanceof Error ? reason.message : undefined);
      return [];
    }
  }

  public async delete(ownerUserId: string, kind: WorkflowStateKind, id: string): Promise<void> {
    this.assertWritable();
    const key = `${ownerUserId}:${kind}:${id}`;
    if (getDatabaseStatus() === 'connected') {
      try {
        await WorkflowStateModel.deleteOne({ ownerUserId, kind, stateId: id }, { writeConcern: { w: 'majority', j: true } }).exec();
      } catch (reason: unknown) {
        throw new WorkflowPersistenceError(reason instanceof Error ? reason.message : undefined);
      }
    } else if (this.requirePersistence) {
      throw new WorkflowPersistenceError();
    }
    this.cache.delete(key);
  }

  public persistenceHealth(): { pendingErrors: number } {
    return { pendingErrors: this.persistenceErrors.length };
  }
}
