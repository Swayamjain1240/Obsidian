import { createHash } from 'node:crypto';

import { getDatabaseStatus } from '../db/connection.js';
import { WorkerLeaseModel } from '../db/models.js';

export type WorkerLeaseState = 'claimed' | 'running' | 'completed' | 'failed' | 'cancelled' | 'recovery' | 'recovered' | 'recovery_failed';

export interface WorkerLease {
  jobId: string;
  ownerId: string;
  leaseTokenHash: string;
  containerName: string;
  state: WorkerLeaseState;
  leaseExpiresAt: number;
  heartbeatAt: number;
  createdAt: number;
  updatedAt: number;
  lastErrorCode: string | null;
}

export interface WorkerLeaseClaim {
  jobId: string;
  ownerId: string;
  leaseToken: string;
  containerName: string;
  leaseExpiresAt: number;
  now: number;
}

export interface WorkerLeaseStore {
  claim(input: WorkerLeaseClaim): Promise<boolean>;
  renew(jobId: string, ownerId: string, leaseToken: string, leaseExpiresAt: number, now: number): Promise<boolean>;
  finish(jobId: string, ownerId: string, leaseToken: string, state: Extract<WorkerLeaseState, 'completed' | 'failed' | 'cancelled'>, now: number, errorCode?: string): Promise<boolean>;
  claimExpired(recoveryOwnerId: string, now: number, recoveryLeaseExpiresAt: number, limit?: number): Promise<WorkerLease[]>;
  markRecovered(jobId: string, recoveryOwnerId: string, state: 'recovered' | 'recovery_failed', now: number, errorCode?: string): Promise<boolean>;
}

export function hashLeaseToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function fromRecord(value: Record<string, unknown>): WorkerLease {
  return {
    jobId: String(value.jobId),
    ownerId: String(value.ownerId),
    leaseTokenHash: String(value.leaseTokenHash),
    containerName: String(value.containerName),
    state: value.state as WorkerLeaseState,
    leaseExpiresAt: new Date(value.leaseExpiresAt as string | Date).getTime(),
    heartbeatAt: new Date(value.heartbeatAt as string | Date).getTime(),
    createdAt: new Date(value.createdAt as string | Date).getTime(),
    updatedAt: new Date(value.updatedAt as string | Date).getTime(),
    lastErrorCode: typeof value.lastErrorCode === 'string' ? value.lastErrorCode : null,
  };
}

export class MongoWorkerLeaseStore implements WorkerLeaseStore {
  public async claim(input: WorkerLeaseClaim): Promise<boolean> {
    if (getDatabaseStatus() !== 'connected') return false;
    const tokenHash = hashLeaseToken(input.leaseToken);
    try {
      await WorkerLeaseModel.create({
        jobId: input.jobId,
        ownerId: input.ownerId,
        leaseTokenHash: tokenHash,
        containerName: input.containerName,
        state: 'running',
        leaseExpiresAt: new Date(input.leaseExpiresAt),
        heartbeatAt: new Date(input.now),
        lastErrorCode: null,
      });
      return true;
    } catch {
      return false;
    }
  }

  public async renew(jobId: string, ownerId: string, leaseToken: string, leaseExpiresAt: number, now: number): Promise<boolean> {
    if (getDatabaseStatus() !== 'connected') return false;
    const updated = await WorkerLeaseModel.updateOne(
      { jobId, ownerId, leaseTokenHash: hashLeaseToken(leaseToken), state: 'running', leaseExpiresAt: { $gt: new Date(now) } },
      { $set: { leaseExpiresAt: new Date(leaseExpiresAt), heartbeatAt: new Date(now) } },
    ).exec().catch(() => null);
    return Boolean(updated && updated.modifiedCount === 1);
  }

  public async finish(jobId: string, ownerId: string, leaseToken: string, state: Extract<WorkerLeaseState, 'completed' | 'failed' | 'cancelled'>, now: number, errorCode?: string): Promise<boolean> {
    if (getDatabaseStatus() !== 'connected') return false;
    const updated = await WorkerLeaseModel.updateOne(
      { jobId, ownerId, leaseTokenHash: hashLeaseToken(leaseToken), state: 'running' },
      { $set: { state, heartbeatAt: new Date(now), leaseExpiresAt: new Date(now), lastErrorCode: errorCode ?? null } },
    ).exec().catch(() => null);
    return Boolean(updated && updated.modifiedCount === 1);
  }

  public async claimExpired(recoveryOwnerId: string, now: number, recoveryLeaseExpiresAt: number, limit = 50): Promise<WorkerLease[]> {
    if (getDatabaseStatus() !== 'connected') return [];
    const records: WorkerLease[] = [];
    for (let index = 0; index < limit; index += 1) {
      const record = await WorkerLeaseModel.findOneAndUpdate(
        { state: { $in: ['claimed', 'running'] }, leaseExpiresAt: { $lte: new Date(now) } },
        { $set: { state: 'recovery', ownerId: recoveryOwnerId, leaseExpiresAt: new Date(recoveryLeaseExpiresAt), heartbeatAt: new Date(now) } },
        { sort: { leaseExpiresAt: 1 }, new: true, lean: true },
      ).exec().catch(() => null);
      if (!record) break;
      records.push(fromRecord(record as unknown as Record<string, unknown>));
    }
    return records;
  }

  public async markRecovered(jobId: string, recoveryOwnerId: string, state: 'recovered' | 'recovery_failed', now: number, errorCode?: string): Promise<boolean> {
    if (getDatabaseStatus() !== 'connected') return false;
    const updated = await WorkerLeaseModel.updateOne(
      { jobId, ownerId: recoveryOwnerId, state: 'recovery' },
      { $set: { state, heartbeatAt: new Date(now), leaseExpiresAt: new Date(now), lastErrorCode: errorCode ?? null } },
    ).exec().catch(() => null);
    return Boolean(updated && updated.modifiedCount === 1);
  }
}

export class InMemoryWorkerLeaseStore implements WorkerLeaseStore {
  private readonly leases = new Map<string, WorkerLease>();

  public async claim(input: WorkerLeaseClaim): Promise<boolean> {
    if (this.leases.has(input.jobId)) return false;
    this.leases.set(input.jobId, {
      jobId: input.jobId,
      ownerId: input.ownerId,
      leaseTokenHash: hashLeaseToken(input.leaseToken),
      containerName: input.containerName,
      state: 'running',
      leaseExpiresAt: input.leaseExpiresAt,
      heartbeatAt: input.now,
      createdAt: input.now,
      updatedAt: input.now,
      lastErrorCode: null,
    });
    return true;
  }

  public async renew(jobId: string, ownerId: string, leaseToken: string, leaseExpiresAt: number, now: number): Promise<boolean> {
    const lease = this.leases.get(jobId);
    if (!lease || lease.ownerId !== ownerId || lease.leaseTokenHash !== hashLeaseToken(leaseToken) || lease.state !== 'running' || lease.leaseExpiresAt <= now) return false;
    lease.leaseExpiresAt = leaseExpiresAt;
    lease.heartbeatAt = now;
    lease.updatedAt = now;
    return true;
  }

  public async finish(jobId: string, ownerId: string, leaseToken: string, state: Extract<WorkerLeaseState, 'completed' | 'failed' | 'cancelled'>, now: number, errorCode?: string): Promise<boolean> {
    const lease = this.leases.get(jobId);
    if (!lease || lease.ownerId !== ownerId || lease.leaseTokenHash !== hashLeaseToken(leaseToken) || lease.state !== 'running') return false;
    lease.state = state;
    lease.leaseExpiresAt = now;
    lease.heartbeatAt = now;
    lease.updatedAt = now;
    lease.lastErrorCode = errorCode ?? null;
    return true;
  }

  public async claimExpired(recoveryOwnerId: string, now: number, recoveryLeaseExpiresAt: number, limit = 50): Promise<WorkerLease[]> {
    const records = [...this.leases.values()].filter((lease) => (lease.state === 'claimed' || lease.state === 'running') && lease.leaseExpiresAt <= now).sort((left, right) => left.leaseExpiresAt - right.leaseExpiresAt).slice(0, limit);
    for (const lease of records) {
      lease.state = 'recovery';
      lease.ownerId = recoveryOwnerId;
      lease.leaseExpiresAt = recoveryLeaseExpiresAt;
      lease.heartbeatAt = now;
      lease.updatedAt = now;
    }
    return records.map((lease) => ({ ...lease }));
  }

  public async markRecovered(jobId: string, recoveryOwnerId: string, state: 'recovered' | 'recovery_failed', now: number, errorCode?: string): Promise<boolean> {
    const lease = this.leases.get(jobId);
    if (!lease || lease.ownerId !== recoveryOwnerId || lease.state !== 'recovery') return false;
    lease.state = state;
    lease.leaseExpiresAt = now;
    lease.heartbeatAt = now;
    lease.updatedAt = now;
    lease.lastErrorCode = errorCode ?? null;
    return true;
  }

  public get(jobId: string): WorkerLease | null {
    const lease = this.leases.get(jobId);
    return lease ? { ...lease } : null;
  }
}
