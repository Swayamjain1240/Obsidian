import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { App } from './App';

vi.mock('./motion', () => ({ useGsapReveal: vi.fn() }));

function response(payload: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload, headers: { get: () => null } };
}

const queued = {
  runId: 'completeness-1',
  detectionRunId: 'detection-1',
  snapshotId: 'snapshot-1',
  baseCommit: 'a'.repeat(40),
  archiveSha256: 'b'.repeat(64),
  status: 'queued',
  projectStatus: null,
  areas: [],
  findings: [],
  fileCount: 4,
  scannedFileCount: 0,
  scannedBytes: 0,
  limited: false,
  warning: null,
  policyVersion: 'part5-v1',
  progress: { stage: 'queued', files: 0, bytes: 0, findings: 0 },
  createdAt: '2026-10-15T00:00:00.000Z',
};

const ready = { ...queued, status: 'awaiting_scope', projectStatus: 'partial', areas: [{ id: 'implementation', name: 'Implementation', status: 'partial', summary: 'One finding.', findingIds: ['implementation-1'], affectedPaths: ['src/index.ts'] }], findings: [{ id: 'implementation-1', kind: 'todo-marker', areaId: 'implementation', status: 'working_with_issues', summary: 'A TODO marker is present.', evidenceRefs: [{ path: 'src/index.ts', line: 3, reason: 'TODO/FIXME marker', kind: 'marker' }], affectedPaths: ['src/index.ts'] }], progress: { stage: 'awaiting_scope', files: 4, bytes: 500, findings: 1 } };

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('completeness frontend flow', () => {
  it('starts from confirmed detection, reviews findings, and records existing-only scope', async () => {
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/auth/me') return Promise.resolve(response({ user: { id: 7, login: 'octocat' }, configured: true, requestId: 'auth' }));
      if (url === '/api/v1/intake/completeness' && init?.method === 'POST') return Promise.resolve(response({ run: queued, requestId: 'start' }, 202));
      if (url.includes('/api/v1/intake/completeness/completeness-1') && url.endsWith('/scope')) return Promise.resolve(response({ run: { ...ready, status: 'scope_selected', scopeMode: 'EXISTING_ONLY', nextPhase: 'baseline_testing' }, requestId: 'scope' }));
      if (url.includes('/api/v1/intake/completeness/completeness-1')) return Promise.resolve(response({ run: ready, requestId: 'get' }));
      return Promise.resolve(response({ repositories: [], pagination: { page: 1, perPage: 5 }, requestId: 'empty' }));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<MemoryRouter initialEntries={['/project/completeness?detectionRunId=detection-1']}><App /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Start completeness review' }));
    await waitFor(() => expect(fetchMock.mock.calls.some((call) => String(call[0]) === '/api/v1/intake/completeness')).toBe(true));
    await waitFor(() => expect(fetchMock.mock.calls.some((call) => String(call[0]) === '/api/v1/intake/completeness/completeness-1')).toBe(true), { timeout: 5000 });
    await screen.findByRole('heading', { name: 'Review project completeness' });
    fireEvent.click(screen.getByRole('tab', { name: 'Findings' }));
    expect(screen.getByRole('option', { name: /todo-marker/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Scope' }));
    fireEvent.click(screen.getByRole('button', { name: /Enhance existing parts only/ }));
    await waitFor(() => expect(screen.getByText('Scope selection is saved.')).toBeTruthy());
    expect(fetchMock.mock.calls.some((call) => String(call[0]).endsWith('/scope'))).toBe(true);
  }, 15_000);
});
