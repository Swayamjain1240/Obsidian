import { describe, expect, it } from 'vitest';

import { DurableWorkflowStore, WorkflowRevisionConflictError } from './store.js';

describe('workflow concurrency integration', () => {
  it('allows one compare-and-set winner for two simulated instances', async () => {
    const store = new DurableWorkflowStore();
    await store.saveVersioned('7', 'workflow_aggregate', 'session-1', { status: 'awaiting_approval', revision: 0 });
    const results = await Promise.allSettled([
      store.saveVersioned('7', 'workflow_aggregate', 'session-1', { status: 'approved' }, 1),
      store.saveVersioned('7', 'workflow_aggregate', 'session-1', { status: 'approved' }, 1),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected' && result.reason instanceof WorkflowRevisionConflictError)).toHaveLength(1);
  });
});
