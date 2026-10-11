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

  it('resolves a branch to a verified commit SHA and archives that commit', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ sha: 'b'.repeat(40) }) })
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-length': '4' }),
        arrayBuffer: async () => new TextEncoder().encode('data').buffer,
      });
    vi.stubGlobal('fetch', fetchMock);

    const client = new GithubApiClient('token');
    const commitSha = await client.getBranchCommitSha({ owner: 'o', name: 'r', branch: 'main' });
    await client.downloadRepositoryArchive({ owner: 'o', name: 'r', branch: 'main', commitSha }, 10);

    expect(commitSha).toBe('b'.repeat(40));
    expect(fetchMock.mock.calls[0][0]).toContain('/commits/main');
    expect(fetchMock.mock.calls[1][0]).toContain(`/tarball/${'b'.repeat(40)}`);
  });

  it('rejects a response that declares an oversized archive', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, headers: new Headers({ 'content-length': '11' }) }));

    await expect(new GithubApiClient('token').downloadRepositoryArchive({ owner: 'o', name: 'r', branch: 'main' }, 10)).rejects.toThrow(/size limit/);
  });

  it('stops a chunked response when it exceeds the configured size limit', async () => {
    const reader = {
      read: vi
        .fn()
        .mockResolvedValueOnce({ done: false, value: new Uint8Array(7) })
        .mockResolvedValueOnce({ done: false, value: new Uint8Array(4) }),
      cancel: vi.fn().mockResolvedValue(undefined),
      releaseLock: vi.fn(),
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers(),
      body: { getReader: () => reader },
    }));

    await expect(new GithubApiClient('token').downloadRepositoryArchive({ owner: 'o', name: 'r', branch: 'main' }, 10)).rejects.toThrow(/size limit/);
    expect(reader.cancel).toHaveBeenCalledOnce();
  });
});
