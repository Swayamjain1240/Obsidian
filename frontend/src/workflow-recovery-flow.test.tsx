import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { App } from './App';

vi.mock('./motion', () => ({ useGsapReveal: vi.fn() }));

function response(payload: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload, headers: { get: () => null } };
}

describe('workflow refresh recovery flow', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('reloads Version 2 state and exact diff from the API instead of browser-only state', async () => {
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/auth/me') return Promise.resolve(response({ user: { id: 7, login: 'recovery-user' }, configured: true, requestId: 'auth' }));
      if (url.endsWith('/api/v1/workflow/version2/version-2')) return Promise.resolve(response({ version2: { version2RunId: 'version-2', ownerUserId: '7', status: 'ready_for_pr', enhancementRunId: 'enhancement-1', manifest: null, receipt: null, revision: 2 }, requestId: 'state' }));
      if (url.endsWith('/api/v1/workflow/version2/version-2/diff')) return Promise.resolve(response({ diff: { version2RunId: 'version-2', manifestId: 'manifest-1', diffHash: 'a'.repeat(64), entries: [{ path: 'src/index.ts', kind: 'modify', beforeSha256: 'b'.repeat(64), afterSha256: 'c'.repeat(64), beforeBytes: 1, afterBytes: 2 }] }, requestId: 'diff' }));
      return Promise.resolve(response({ repositories: [], pagination: { page: 1, perPage: 5 }, requestId: 'empty' }));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<MemoryRouter initialEntries={['/project/delivery?version2RunId=version-2']}><App /></MemoryRouter>);
    expect(await screen.findByText(/modify · src\/index\.ts/)).toBeVisible();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Prepare pull request' })).toBeEnabled());
    expect(fetchMock.mock.calls.some((call) => String(call[0]).endsWith('/version2/version-2'))).toBe(true);
  });
});
