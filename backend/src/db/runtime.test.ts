import { describe, expect, it } from 'vitest';

import { getDatabaseRuntimeStatus } from './runtime.js';

describe('database runtime status', () => {
  it('reports disconnected state without sensitive connection details', async () => {
    const status = await getDatabaseRuntimeStatus();
    expect(status.status).toBe('not_connected');
    expect(status.pingMs).toBeNull();
    expect(status.topology).toBe('unknown');
    expect(status.transactionsSupported).toBe(false);
  });
});
