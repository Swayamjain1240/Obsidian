import { operationDigest } from './revision.js';
import type { WorkflowStore } from './store.js';
import { WorkflowRevisionConflictError } from './store.js';

export interface IdempotencyRecord<T = unknown> {
  ownerUserId: string;
  key: string;
  operation: string;
  requestHash: string;
  status: 'running' | 'completed' | 'failed';
  response?: T;
  createdAt: string;
  expiresAt: string;
  revision?: number;
  stateRevision?: number;
}

export class IdempotencyConflictError extends Error {
  public constructor(message = 'The idempotency key was already used with a different request.') {
    super(message);
    this.name = 'IdempotencyConflictError';
  }
}

export class IdempotencyLedger {
  private readonly records = new Map<string, IdempotencyRecord>();

  public constructor(private readonly store?: WorkflowStore) {}

  public async run<T>(input: {
    ownerUserId: string;
    key: string;
    operation: string;
    request: unknown;
    execute: () => Promise<T>;
    ttlMs?: number;
    stateRevision?: number;
  }): Promise<T> {
    if (!/^[A-Za-z0-9._:-]{8,200}$/.test(input.key)) throw new IdempotencyConflictError('The idempotency key is invalid.');
    const requestHash = operationDigest(input.request);
    const recordKey = `${input.ownerUserId}:${input.operation}:${input.key}`;
    const existing = await this.load(input.ownerUserId, recordKey);
    const now = Date.now();
    const activeExisting = existing && Date.parse(existing.expiresAt) > now ? existing : undefined;
    if (activeExisting) {
      if (activeExisting.requestHash !== requestHash) throw new IdempotencyConflictError();
      if (activeExisting.status === 'completed') return activeExisting.response as T;
      if (activeExisting.status === 'running') throw new IdempotencyConflictError('The same workflow request is already in progress.');
    }
    const record: IdempotencyRecord = {
      ownerUserId: input.ownerUserId,
      key: input.key,
      operation: input.operation,
      requestHash,
      status: 'running',
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + (input.ttlMs ?? 24 * 60 * 60 * 1000)).toISOString(),
      stateRevision: input.stateRevision,
    };
    let persisted: IdempotencyRecord;
    try {
      persisted = await this.write(input.ownerUserId, recordKey, record, activeExisting?.revision);
    } catch (reason: unknown) {
      if (!(reason instanceof WorkflowRevisionConflictError)) throw reason;
      const winner = await this.load(input.ownerUserId, recordKey);
      if (winner?.requestHash === requestHash && winner.status === 'completed') return winner.response as T;
      throw new IdempotencyConflictError('The same workflow request is already in progress.');
    }
    const running = { ...record, revision: persisted.revision };
    try {
      const response = await input.execute();
      await this.write(input.ownerUserId, recordKey, { ...running, status: 'completed', response }, running.revision);
      return response;
    } catch (error) {
      await this.write(input.ownerUserId, recordKey, { ...running, status: 'failed' }, running.revision);
      throw error;
    }
  }

  public clearExpired(now = Date.now()): void {
    for (const [key, record] of this.records) if (Date.parse(record.expiresAt) <= now) this.records.delete(key);
  }

  private async load(ownerUserId: string, recordKey: string): Promise<IdempotencyRecord | null> {
    const cached = this.records.get(recordKey);
    if (cached) return cached;
    const persisted = await this.store?.get<IdempotencyRecord>(ownerUserId, 'idempotency', recordKey);
    if (persisted) this.records.set(recordKey, persisted);
    return persisted ?? null;
  }

  private async write(ownerUserId: string, recordKey: string, record: IdempotencyRecord, expectedRevision?: number): Promise<IdempotencyRecord> {
    const persisted = this.store
      ? await this.store.saveVersioned(ownerUserId, 'idempotency', recordKey, record, expectedRevision)
      : record;
    this.records.set(recordKey, persisted);
    return persisted;
  }
}
