import { describe, expect, it } from 'vitest';

import { InMemoryWorkerLeaseStore } from './lease-store.js';

describe('durable worker lease semantics', () => {
  it('allows one owner to claim a job and rejects duplicate claims', async () => {
    const store = new InMemoryWorkerLeaseStore();
    const input = { jobId: 'job-1', ownerId: 'owner-a', leaseToken: 'token-a', containerName: 'obsidian-smoke-00000000-0000-4000-8000-000000000001', leaseExpiresAt: 10_000, now: 1_000 };
    const results = await Promise.all([store.claim(input), store.claim({ ...input, ownerId: 'owner-b', leaseToken: 'token-b' })]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('renews only with the current owner/token and before expiry', async () => {
    const store = new InMemoryWorkerLeaseStore();
    await store.claim({ jobId: 'job-2', ownerId: 'owner-a', leaseToken: 'token-a', containerName: 'obsidian-smoke-00000000-0000-4000-8000-000000000002', leaseExpiresAt: 2_000, now: 1_000 });
    expect(await store.renew('job-2', 'owner-b', 'token-a', 3_000, 1_500)).toBe(false);
    expect(await store.renew('job-2', 'owner-a', 'wrong', 3_000, 1_500)).toBe(false);
    expect(await store.renew('job-2', 'owner-a', 'token-a', 3_000, 1_500)).toBe(true);
    expect(await store.renew('job-2', 'owner-a', 'token-a', 4_000, 3_500)).toBe(false);
  });

  it('claims only expired jobs for recovery and makes completion idempotent', async () => {
    const store = new InMemoryWorkerLeaseStore();
    await store.claim({ jobId: 'expired', ownerId: 'owner-a', leaseToken: 'token-a', containerName: 'obsidian-smoke-00000000-0000-4000-8000-000000000003', leaseExpiresAt: 1_000, now: 0 });
    await store.claim({ jobId: 'active', ownerId: 'owner-a', leaseToken: 'token-b', containerName: 'obsidian-smoke-00000000-0000-4000-8000-000000000004', leaseExpiresAt: 10_000, now: 0 });
    const claimed = await store.claimExpired('recovery-owner', 2_000, 5_000);
    expect(claimed.map((lease) => lease.jobId)).toEqual(['expired']);
    expect(await store.markRecovered('expired', 'recovery-owner', 'recovered', 2_100)).toBe(true);
    expect(await store.markRecovered('expired', 'recovery-owner', 'recovered', 2_200)).toBe(false);
    expect(store.get('active')?.state).toBe('running');
  });

  it('fences an old worker after recovery takeover', async () => {
    const store = new InMemoryWorkerLeaseStore();
    const job = 'fenced-job';
    await store.claim({ jobId: job, ownerId: 'owner-a', leaseToken: 'token-a', containerName: 'obsidian-smoke-00000000-0000-4000-8000-000000000005', leaseExpiresAt: 1_000, now: 0 });
    const oldLease = store.get(job);
    expect(oldLease?.fence).toBe(1);
    const recovered = await store.claimExpired('recovery-owner', 2_000, 5_000);
    expect(recovered[0]?.fence).toBe(2);
    expect(await store.finish(job, 'owner-a', 'token-a', 'completed', 2_100, undefined, 1)).toBe(false);
    expect(await store.markRecovered(job, 'recovery-owner', 'recovered', 2_200, undefined, 2)).toBe(true);
  });
});
