import { describe, expect, it } from 'vitest';

import { connectDatabase, disconnectDatabase } from './connection.js';
import { WorkflowStateModel } from './models.js';

const enabled = process.env.OBSIDIAN_ALLOW_DISPOSABLE_MONGO_TESTS === '1' && Boolean(process.env.OBSIDIAN_MONGODB_TEST_URI);
const suite = enabled ? describe : describe.skip;

suite('MongoDB outage integration contract', () => {
  it('reconnects and writes after the disposable primary is stopped', async () => {
    expect(process.env.OBSIDIAN_MONGODB_TEST_URI).toContain('obsidian_phase3');
    expect(process.env.OBSIDIAN_MONGODB_FAILOVER).toBe('1');
    await connectDatabase(process.env.OBSIDIAN_MONGODB_TEST_URI!);
    try {
      const stateId = `failover-${Date.now()}`;
      await WorkflowStateModel.create({ ownerUserId: 'owner-failover', kind: 'workflow_aggregate', stateId, schemaVersion: 2, revision: 1, payload: { status: 'reconnected' } });
      expect(await WorkflowStateModel.exists({ stateId })).toBeTruthy();
    } finally {
      await disconnectDatabase();
    }
  });
});
