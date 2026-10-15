import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { App } from './App';

vi.mock('./motion', () => ({ useGsapReveal: vi.fn() }));

function response(payload: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload, headers: { get: () => null } };
}

const queued = {
  runId: 'baseline-1', completenessRunId: 'completeness-1', snapshotId: 'snapshot-1', baseCommit: 'a'.repeat(40), archiveSha256: 'b'.repeat(64), scopeMode: 'EXISTING_ONLY', status: 'queued', checks: [], passedCount: 0, failedCount: 0, notAvailableCount: 0, warning: null, policyVersion: 'part6-v1', progress: { stage: 'queued', checksCompleted: 0, checksTotal: 0, passed: 0, failed: 0, notAvailable: 0 }, createdAt: '2026-10-15T00:00:00.000Z',
};
const ready = { ...queued, status: 'passed', checks: [{ id: 'unit', category: 'unit', label: 'Unit tests', status: 'passed', summary: 'Unit tests completed successfully.', commandLabel: 'npm run test', exitCode: 0, durationMs: 12, evidenceRefs: [{ path: 'package.json', reason: 'test script selected', kind: 'manifest' }] }], passedCount: 1, progress: { stage: 'passed', checksCompleted: 1, checksTotal: 1, passed: 1, failed: 0, notAvailable: 0 }, nextPhase: 'enhancement_analysis' };

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('baseline frontend flow', () => {
  it('starts from a selected completeness scope and reviews executed checks', async () => {
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/auth/me') return Promise.resolve(response({ user: { id: 7, login: 'octocat' }, configured: true, requestId: 'auth' }));
      if (url === '/api/v1/intake/baseline' && init?.method === 'POST') return Promise.resolve(response({ run: queued, requestId: 'start' }, 202));
      if (url === '/api/v1/intake/baseline/baseline-1') return Promise.resolve(response({ run: ready, requestId: 'get' }));
      return Promise.resolve(response({ repositories: [], pagination: { page: 1, perPage: 5 }, requestId: 'empty' }));
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<MemoryRouter initialEntries={['/project/baseline?completenessRunId=completeness-1']}><App /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Start baseline checks' }));
    await waitFor(() => expect(fetchMock.mock.calls.map((call) => String(call[0]))).toContain('/api/v1/intake/baseline/baseline-1'), { timeout: 5000 });
    expect(await screen.findByRole('heading', { name: 'Review baseline evidence' })).toBeTruthy();
    expect(screen.getByRole('option', { name: /Unit tests/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Run details' }));
    fireEvent.change(screen.getByLabelText('Baseline run detail'), { target: { value: '5' } });
    expect(screen.getByText(/enhancement analysis/)).toBeTruthy();
  });
});
