import { describe, expect, it } from 'vitest';

import { DurableWorkflowStore, WorkflowRevisionConflictError } from './store.js';

describe('durable workflow store', () => {
  it('keeps revisions isolated from caller mutation and rejects stale writes', async () => {
    const store = new DurableWorkflowStore();
    const first = await store.saveVersioned('owner', 'repair_plan', 'plan', { value: 'first' });
    expect(first.revision).toBe(1);

    first.value = 'mutated-after-save';
    const current = await store.get<{ value: string; revision?: number }>('owner', 'repair_plan', 'plan');
    expect(current?.value).toBe('first');

    const second = await store.saveVersioned('owner', 'repair_plan', 'plan', { value: 'second' }, 1);
    expect(second.revision).toBe(2);
    await expect(store.saveVersioned('owner', 'repair_plan', 'plan', { value: 'stale' }, 1)).rejects.toBeInstanceOf(WorkflowRevisionConflictError);
  });
});
