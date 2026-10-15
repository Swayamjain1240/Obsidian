import { afterEach, describe, expect, it, vi } from 'vitest';

import { cancelBaseline, startBaseline } from './api';

function response(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('baseline API contract', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('starts a baseline from an explicitly selected completeness run', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ run: { runId: 'baseline-1', status: 'planning' }, requestId: 'start' }, 202));
    vi.stubGlobal('fetch', fetchMock);
    await startBaseline('completeness-1');
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/intake/baseline', expect.objectContaining({ method: 'POST', body: JSON.stringify({ completenessRunId: 'completeness-1' }) }));
  });

  it('uses a separate cancellation route', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ run: { runId: 'baseline-1', status: 'cancelled' }, requestId: 'cancel' }));
    vi.stubGlobal('fetch', fetchMock);
    await cancelBaseline('baseline-1');
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/intake/baseline/baseline-1/cancel');
  });
});
