import { describe, expect, it } from 'vitest';

import { DurableEventStore, EventPersistenceError } from './events-store.js';
import { createSystemEvent } from './events.js';

describe('durable audit event policy', () => {
  it('fails closed for required audit persistence while MongoDB is unavailable', async () => {
    const event = createSystemEvent({ eventType: 'TEST', sessionId: 'session', projectId: 'project', runId: 'run', baseCommit: 'a'.repeat(40), phase: 'test', status: 'passed', safeSummary: 'safe', affectedPaths: [], userActionRequired: false });
    await expect(new DurableEventStore(true).append(event)).rejects.toBeInstanceOf(EventPersistenceError);
  });
});
