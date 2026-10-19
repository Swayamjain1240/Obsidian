import { describe, expect, it } from 'vitest';

import { IdempotencyConflictError, IdempotencyLedger } from './idempotency.js';
import { DurableWorkflowStore } from './store.js';

describe('workflow idempotency', () => {
  it('reuses a completed response and rejects changed payloads', async () => {
    const ledger = new IdempotencyLedger();
    let calls = 0;
    const input = { ownerUserId: '7', key: 'request-1234', operation: 'approve', request: { itemId: 'a' } };
    const first = await ledger.run({ ...input, execute: async () => { calls += 1; return { ok: true }; } });
    const second = await ledger.run({ ...input, execute: async () => { calls += 1; return { ok: false }; } });
    expect(first).toEqual({ ok: true });
    expect(second).toEqual({ ok: true });
    expect(calls).toBe(1);
    await expect(ledger.run({ ...input, request: { itemId: 'b' }, execute: async () => ({ ok: false }) })).rejects.toBeInstanceOf(IdempotencyConflictError);
  });

  it('reuses a durable receipt across ledger instances', async () => {
    const store = new DurableWorkflowStore();
    const first = new IdempotencyLedger(store);
    const second = new IdempotencyLedger(store);
    await first.run({ ownerUserId: '7', key: 'durable-1234', operation: 'create', request: { value: 1 }, execute: async () => ({ receipt: 'saved' }) });
    let calls = 0;
    expect(await second.run({ ownerUserId: '7', key: 'durable-1234', operation: 'create', request: { value: 1 }, execute: async () => { calls += 1; return { receipt: 'new' }; } })).toEqual({ receipt: 'saved' });
    expect(calls).toBe(0);
  });
});
