import mongoose from 'mongoose';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';

import { connectDatabase, disconnectDatabase } from './connection.js';
import { DurableRunStateModel, WorkerLeaseModel, WorkflowStateModel } from './models.js';

const enabled = process.env.OBSIDIAN_ALLOW_DISPOSABLE_MONGO_TESTS === '1' && Boolean(process.env.OBSIDIAN_MONGODB_TEST_URI);
const suite = enabled ? describe : describe.skip;

suite('MongoDB disposable integration', () => {
  beforeAll(async () => {
    const uri = process.env.OBSIDIAN_MONGODB_TEST_URI!;
    if (!uri.includes('obsidian_phase3')) throw new Error('Refusing a non-disposable MongoDB database.');
    await connectDatabase(uri);
    await Promise.all([DurableRunStateModel.syncIndexes(), WorkflowStateModel.syncIndexes(), WorkerLeaseModel.syncIndexes()]);
  });

  afterAll(async () => { await disconnectDatabase(); });

  it('persists owner-scoped state and declared indexes in a replica set', async () => {
    await WorkflowStateModel.create({ ownerUserId: 'owner-1', kind: 'workflow_aggregate', stateId: 'workflow-1', schemaVersion: 2, revision: 1, payload: { status: 'queued' } });
    const record = await WorkflowStateModel.findOne({ ownerUserId: 'owner-1', stateId: 'workflow-1' }).lean().exec();
    expect(record?.payload).toEqual({ status: 'queued' });
    expect((await WorkflowStateModel.listIndexes()).some((index) => index.name === 'ownerUserId_1_kind_1_stateId_1')).toBe(true);
  });
});
