import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { App } from './App';

vi.mock('./motion', () => ({ useGsapReveal: vi.fn() }));

function response(payload: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload, headers: { get: () => null } };
}

const plan = {
  planId: 'repair-plan-1', baselineRunId: 'baseline-1', completenessRunId: 'complete-1', snapshotId: 'snapshot-1', baseCommit: 'a'.repeat(40), ownerUserId: '7', status: 'awaiting_approval', branchName: null, validationId: null, warning: null, createdAt: '2026-10-15T00:00:00.000Z', updatedAt: '2026-10-15T00:00:00.000Z',
  items: [{ id: 'repair-item-1', planId: 'repair-plan-1', sourceCheckId: 'build', category: 'build', title: 'Review Build', reason: 'Build failed.', risk: 'low', affectedPaths: ['package.json'], expectedTests: ['Build'], approvalState: 'awaiting_approval', operations: [], workerStatus: 'pending' }],
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('workflow frontend flow', () => {
  it('submits an explicit approved operation instead of silently approving an empty change', async () => {
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/auth/me') return Promise.resolve(response({ user: { id: 7, login: 'qa-user' }, configured: true, requestId: 'auth' }));
      if (url === '/api/v1/workflow/repairs' && init?.method === 'POST') return Promise.resolve(response({ plan, requestId: 'create' }, 202));
      if (url.includes('/approval') && init?.method === 'POST') return Promise.resolve(response({ plan: { ...plan, status: 'approved', items: [{ ...plan.items[0], approvalState: 'approved', operations: [{ kind: 'modify', path: 'src/fixed.ts', contentHash: 'hash', contentBytes: 5 }] }] }, requestId: 'approve' }));
      return Promise.resolve(response({ repositories: [], pagination: { page: 1, perPage: 5 }, requestId: 'empty' }));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<MemoryRouter initialEntries={['/project/repair?baselineRunId=baseline-1']}><App /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Create repair plan' }));
    const path = await screen.findByLabelText('Repository-relative path');
    fireEvent.change(path, { target: { value: 'src/fixed.ts' } });
    fireEvent.change(screen.getByLabelText('Approved file content'), { target: { value: 'fixed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Approve operation' }));

    await waitFor(() => expect(fetchMock.mock.calls.some((call) => String(call[0]).includes('/approval'))).toBe(true));
    const approvalCall = fetchMock.mock.calls.find((call) => String(call[0]).includes('/approval'));
    const body = JSON.parse(String(approvalCall?.[1]?.body));
    expect(body.operations).toEqual([{ kind: 'modify', path: 'src/fixed.ts', content: 'fixed' }]);
  });
});
