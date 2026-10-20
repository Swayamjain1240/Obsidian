import { describe, expect, it, beforeAll, afterAll } from 'vitest';

import { connectDatabase, disconnectDatabase } from '../db/connection.js';
import { WorkerLeaseModel } from '../db/models.js';
import { MongoWorkerLeaseStore } from './lease-store.js';

const enabled = process.env.OBSIDIAN_ALLOW_DISPOSABLE_MONGO_TESTS === '1' && Boolean(process.env.OBSIDIAN_MONGODB_TEST_URI);
const suite = enabled ? describe : describe.skip;

suite('MongoDB worker lease failover integration', () => {
  const store = new MongoWorkerLeaseStore();
  const secondStore = new MongoWorkerLeaseStore();
  const jobId = `lease-${Date.now()}`;
  const concurrentJobIds = [`lease-concurrent-a-${Date.now()}`, `lease-concurrent-b-${Date.now()}`];
  beforeAll(async () => { await connectDatabase(process.env.OBSIDIAN_MONGODB_TEST_URI!); await WorkerLeaseModel.syncIndexes(); await WorkerLeaseModel.deleteMany({ jobId: { $in: [jobId, ...concurrentJobIds] } }); });
  afterAll(async () => { await WorkerLeaseModel.deleteMany({ jobId: { $in: [jobId, ...concurrentJobIds] } }); await disconnectDatabase(); });

  it('fences the old owner after durable recovery takeover', async () => {
    expect(await store.claim({ jobId, ownerId: 'owner-a', leaseToken: 'token-a', containerName: `obsidian-smoke-${jobId}`, leaseExpiresAt: 1_000, now: 0 })).toBe(true);
    const before = await store.get(jobId);
    const recovered = await store.claimExpired('recovery-owner', 2_000, 5_000);
    expect(recovered).toHaveLength(1);
    expect(recovered[0].fence).toBe((before?.fence ?? 0) + 1);
    expect(await store.finish(jobId, 'owner-a', 'token-a', 'completed', 2_100, undefined, before?.fence)).toBe(false);
    expect(await store.markRecovered(jobId, 'recovery-owner', 'recovered', 2_200, undefined, recovered[0].fence)).toBe(true);
  });

  it('allows only one of two recovery workers to claim each expired job', async () => {
    for (const [index, concurrentJobId] of concurrentJobIds.entries()) {
      expect(await store.claim({ jobId: concurrentJobId, ownerId: 'owner-concurrent', leaseToken: `token-${index}`, containerName: `obsidian-smoke-${concurrentJobId}`, leaseExpiresAt: 1_000, now: 0 })).toBe(true);
    }
    const [first, second] = await Promise.all([
      store.claimExpired('recovery-a', 2_000, 5_000),
      secondStore.claimExpired('recovery-b', 2_000, 5_000),
    ]);
    const claims = [...first, ...second].filter((lease) => concurrentJobIds.includes(lease.jobId));
    expect(claims).toHaveLength(2);
    expect(new Set(claims.map((lease) => lease.jobId)).size).toBe(2);
    for (const lease of claims) expect(await store.markRecovered(lease.jobId, lease.ownerId, 'recovered', 2_100, undefined, lease.fence)).toBe(true);
  });
});
