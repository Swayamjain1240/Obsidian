import mongoose from 'mongoose';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';

import { connectDatabase, disconnectDatabase } from './connection.js';
import { withMongoTransaction } from './transactions.js';
import { WorkflowStateModel } from './models.js';

const enabled = process.env.OBSIDIAN_ALLOW_DISPOSABLE_MONGO_TESTS === '1' && Boolean(process.env.OBSIDIAN_MONGODB_TEST_URI);
const suite = enabled ? describe : describe.skip;

suite('MongoDB transaction integration', () => {
  beforeAll(async () => { await connectDatabase(process.env.OBSIDIAN_MONGODB_TEST_URI!); });
  afterAll(async () => { await disconnectDatabase(); });

  it('commits coupled state and rolls back aborted changes', async () => {
    await withMongoTransaction(async (session) => {
      await WorkflowStateModel.create([{ ownerUserId: 'owner-tx', kind: 'workflow_aggregate', stateId: 'commit', schemaVersion: 2, revision: 1, payload: { status: 'committed' } }], { session });
    });
    await expect(withMongoTransaction(async (session) => {
      await WorkflowStateModel.create([{ ownerUserId: 'owner-tx', kind: 'workflow_aggregate', stateId: 'rollback', schemaVersion: 2, revision: 1, payload: { status: 'rolled_back' } }], { session });
      throw new Error('abort-test');
    })).rejects.toThrow('abort-test');
    expect(await WorkflowStateModel.exists({ stateId: 'commit' })).toBeTruthy();
    expect(await WorkflowStateModel.exists({ stateId: 'rollback' })).toBeFalsy();
  });
});
