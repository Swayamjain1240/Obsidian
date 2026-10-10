import { afterEach, describe, expect, it, vi } from 'vitest';

import { GithubApiClient } from './client.js';

describe('GitHub repository archive download', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('downloads a bounded archive using the authenticated API', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-length': '4' }),
      arrayBuffer: async () => new TextEncoder().encode('data').buffer,
    });
    vi.stubGlobal('fetch', fetchMock);

    const archive = await new GithubApiClient('token').downloadRepositoryArchive({ owner: 'o', name: 'r', branch: 'main' }, 10);

    expect(new TextDecoder().decode(archive)).toBe('data');
    expect(fetchMock.mock.calls[0][0]).toContain('/repos/o/r/tarball/main');
  });

  it('rejects a response that declares an oversized archive', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, headers: new Headers({ 'content-length': '11' }) }));

    await expect(new GithubApiClient('token').downloadRepositoryArchive({ owner: 'o', name: 'r', branch: 'main' }, 10)).rejects.toThrow(/size limit/);
  });
});
