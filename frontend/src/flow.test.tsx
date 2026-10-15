import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { App } from './App';

function response(payload: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => payload,
    headers: { get: () => null },
  };
}

const candidateRun = {
  runId: 'run-42',
  snapshotId: 'snapshot-42',
  baseCommit: 'abc123',
  archiveSha256: 'hash-42',
  status: 'awaiting_confirmation',
  candidates: [{
    id: 'typescript',
    language: 'TypeScript',
    frameworks: ['React'],
    packageManager: 'npm',
    evidenceStrength: 'strong',
    evidenceRefs: [{ path: 'package.json', reason: 'dependency marker', kind: 'dependency-marker' }],
    adapterAvailable: true,
  }],
  primaryCandidateId: 'typescript',
  unknownReason: null,
  fileCount: 8,
  evidenceFileCount: 1,
  policyVersion: 'v1',
  progress: { stage: 'evidence_finalized', files: 8, bytes: 4096 },
  createdAt: '2026-01-01T00:00:00.000Z',
};

describe('authenticated frontend flow', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    window.sessionStorage.clear();
  });

  it('shows the real login gate and never opens a mock repository picker', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ user: null, configured: true, requestId: 'auth-1' }));
    vi.stubGlobal('fetch', fetchMock);

    render(
      <MemoryRouter initialEntries={['/home']}>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: 'Improve your project safely' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Continue with GitHub' })).toHaveAttribute('href', '/auth/github/start');
    await waitFor(() => expect(screen.getByText('Your project stays yours.')).toBeTruthy());
    expect(screen.queryByText('dashboard-app')).toBeNull();
  });

  it('loads a run by GET, confirms selected IDs, and shows the locked next phase', async () => {
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/auth/me') return Promise.resolve(response({ user: { id: 7, login: 'octocat' }, configured: true, requestId: 'auth-2' }));
      if (url === '/api/v1/intake/detections/run-42' && !init?.method) return Promise.resolve(response({ run: candidateRun, requestId: 'get-42' }));
      if (url === '/api/v1/intake/detections/run-42/confirm' && init?.method === 'POST') {
        return Promise.resolve(response({ run: { ...candidateRun, status: 'confirmed', confirmedCandidateIds: ['typescript'] }, requestId: 'confirm-42' }));
      }
      return Promise.resolve(response({ repositories: [], pagination: { page: 1, perPage: 5 }, requestId: 'empty' }));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <MemoryRouter initialEntries={['/project/confirm?runId=run-42']}>
        <App />
      </MemoryRouter>,
    );

    await screen.findByRole('heading', { name: 'Confirm the detected stack' });
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Select TypeScript' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm 1 selected' }));

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Stack confirmation is locked.' })).toBeTruthy());
    const getCalls = fetchMock.mock.calls.filter((call) => String(call[0]).includes('/detections/run-42') && !call[1]?.method);
    expect(getCalls.length).toBeGreaterThan(0);
    expect(fetchMock.mock.calls.some((call) => String(call[0]).endsWith('/confirm') && call[1]?.method === 'POST')).toBe(true);
  });

  it('requires an explicit Not detected confirmation when no candidates exist', async () => {
    const emptyRun = { ...candidateRun, runId: 'run-empty', candidates: [], primaryCandidateId: null, unknownReason: 'No supported evidence was found.' };
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/auth/me') return Promise.resolve(response({ user: { id: 7, login: 'octocat' }, configured: true, requestId: 'auth-3' }));
      if (url === '/api/v1/intake/detections/run-empty' && !init?.method) return Promise.resolve(response({ run: emptyRun, requestId: 'get-empty' }));
      if (url === '/api/v1/intake/detections/run-empty/confirm' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body));
        expect(body).toEqual({ candidateIds: [], notDetected: true });
        return Promise.resolve(response({ run: { ...emptyRun, status: 'confirmed' }, requestId: 'confirm-empty' }));
      }
      return Promise.resolve(response({ repositories: [], pagination: { page: 1, perPage: 5 }, requestId: 'empty' }));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <MemoryRouter initialEntries={['/project/confirm?runId=run-empty']}>
        <App />
      </MemoryRouter>,
    );

    await screen.findByText('No candidates were detected.');
    fireEvent.click(screen.getByRole('button', { name: 'Confirm: Not detected' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Stack confirmation is locked.' })).toBeTruthy());
  });
});
