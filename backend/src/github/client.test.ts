import { afterEach, describe, expect, it, vi } from 'vitest';

import { GithubApiClient } from './client.js';

describe('GitHub API client', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('exchanges an OAuth code without exposing the token in errors', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'secret-token', token_type: 'bearer' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = await GithubApiClient.exchangeCode({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      code: 'oauth-code',
      redirectUri: 'http://localhost:4000/auth/github/callback',
      codeVerifier: 'verifier',
    });

    expect(client).toBeInstanceOf(GithubApiClient);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://github.com/login/oauth/access_token',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain('secret-token');
  });

  it('lists repositories with bounded pagination', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [],
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new GithubApiClient('access-token');
    await client.listRepositories(2, 1000);

    const calledUrl = new URL(fetchMock.mock.calls[0][0]);
    expect(calledUrl.searchParams.get('page')).toBe('2');
    expect(calledUrl.searchParams.get('per_page')).toBe('100');
  });
});
