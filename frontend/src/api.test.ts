import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchIntakeStatus } from './api';

describe('frontend intake API', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns the explicit backend capability status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ status: { github: 'implemented', aiAnalysis: 'not_available' } }),
      }),
    );

    const status = await fetchIntakeStatus();

    expect(status.github).toBe('implemented');
    expect(status.aiAnalysis).toBe('not_available');
  });

  it('fails honestly when the backend is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));

    await expect(fetchIntakeStatus()).rejects.toThrow(/Backend status is unavailable/);
  });
});
