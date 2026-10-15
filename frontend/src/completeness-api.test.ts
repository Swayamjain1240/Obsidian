import { afterEach, describe, expect, it, vi } from 'vitest';

import { cancelCompleteness, selectCompletenessScope, startCompleteness } from './api';

function response(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('completeness API contract', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('starts a review and sends the explicit detection run ID', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ run: { runId: 'complete-1', status: 'queued' }, requestId: 'start-1' }, 202));
    vi.stubGlobal('fetch', fetchMock);

    await startCompleteness('detection-1');

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/intake/completeness', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ detectionRunId: 'detection-1' }),
    }));
  });

  it('selects scope and supports cancellation through separate mutation routes', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ run: { runId: 'complete-1', status: 'scope_selected', scopeMode: 'EXISTING_ONLY' }, requestId: 'scope-1' }))
      .mockResolvedValueOnce(response({ run: { runId: 'complete-1', status: 'cancelled' }, requestId: 'cancel-1' }));
    vi.stubGlobal('fetch', fetchMock);

    await selectCompletenessScope('complete-1', 'EXISTING_ONLY');
    await cancelCompleteness('complete-1');

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ mode: 'EXISTING_ONLY' });
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/intake/completeness/complete-1/scope');
    expect(fetchMock.mock.calls[1][0]).toBe('/api/v1/intake/completeness/complete-1/cancel');
  });
});
