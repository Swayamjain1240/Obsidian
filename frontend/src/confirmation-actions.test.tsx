import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConfirmationPage } from './pages/ConfirmationPage';
import { MINIMUM_SCAN_MS } from './hooks/useDetectionRun';

vi.mock('./motion', () => ({ useGsapReveal: vi.fn() }));

function run(id = 'run-original', candidate = 'TypeScript', status = 'awaiting_confirmation') {
  return { runId: id, snapshotId: 'snapshot-original', baseCommit: 'commit-original', archiveSha256: 'hash-original', status, candidates: [{ id: candidate, language: candidate, frameworks: [], packageManager: null, evidenceStrength: 'strong', evidenceRefs: [], adapterAvailable: false }], primaryCandidateId: candidate, unknownReason: null, fileCount: 10, evidenceFileCount: 1, policyVersion: 'v1', progress: { stage: 'evidence_finalized', files: 10, bytes: 512 }, createdAt: '2026-01-01T00:00:00.000Z' };
}
function response(payload: unknown, status = 200) { return new Response(JSON.stringify(payload), { status }); }
async function flush() { await act(async () => { for (let i = 0; i < 12; i += 1) await Promise.resolve(); }); }

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); window.sessionStorage.clear(); });

describe('confirmation actions', () => {
  it('offers rescan for valid candidates, clears the previous selection, and confirms only the new run', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockImplementation((input: string) => Promise.resolve(response({ run: input.endsWith('/rescan') ? run('run-rescan', 'JavaScript') : input.endsWith('/confirm') ? { ...run('run-rescan', 'JavaScript', 'confirmed'), confirmedCandidateIds: ['JavaScript'] } : run() })));
    vi.stubGlobal('fetch', fetchMock);
    render(<MemoryRouter initialEntries={['/project/confirm?runId=run-original']}><ConfirmationPage /></MemoryRouter>, { reactStrictMode: true });
    await flush();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select TypeScript' }));
    expect(screen.getByRole('button', { name: 'Confirm 1 selected' })).toBeEnabled();
    const rescan = screen.getByRole('button', { name: 'Rescan snapshot' });
    act(() => { fireEvent.click(rescan); fireEvent.click(rescan); });
    await flush();
    expect(screen.getByRole('status')).toHaveTextContent('Scan complete — review opens shortly');
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(fetchMock.mock.calls.filter((call) => call[0].endsWith('/rescan'))).toHaveLength(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(MINIMUM_SCAN_MS); });
    expect(screen.getByRole('button', { name: 'Confirm 0 selected' })).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select JavaScript' }));
    const confirm = screen.getByRole('button', { name: 'Confirm 1 selected' });
    act(() => { fireEvent.click(confirm); fireEvent.click(confirm); });
    await flush();
    expect(screen.getByRole('heading', { name: 'Stack confirmation is locked.' })).toBeTruthy();
    const post = fetchMock.mock.calls.filter((call) => call[0].endsWith('/confirm'));
    expect(post).toHaveLength(1);
    expect(post[0][0]).toBe('/api/v1/intake/detections/run-rescan/confirm');
    expect(JSON.parse(post[0][1].body)).toEqual({ candidateIds: ['JavaScript'], notDetected: false });
  });

  it('shows a failed confirmation clearly and recovers with GET rather than repeating a POST', async () => {
    const fetchMock = vi.fn().mockImplementation((input: string) => Promise.resolve(input.endsWith('/confirm') ? response({ error: { code: 'SAVE_UNAVAILABLE', message: 'Confirmation could not be saved.' } }, 503) : response({ run: run() })));
    vi.stubGlobal('fetch', fetchMock);
    render(<MemoryRouter initialEntries={['/project/confirm?runId=run-original']}><ConfirmationPage /></MemoryRouter>);
    await flush();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select TypeScript' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm 1 selected' }));
    await flush();
    expect(screen.getByRole('alert')).toHaveTextContent('Confirmation could not be saved.');
    fireEvent.click(screen.getByRole('button', { name: 'Reload run' }));
    await flush();
    expect(screen.getByRole('heading', { name: 'Confirm the detected stack' })).toBeTruthy();
    expect(fetchMock.mock.calls.filter((call) => call[0].endsWith('/confirm'))).toHaveLength(1);
    expect(fetchMock.mock.calls.filter((call) => !call[1]?.method)).toHaveLength(2);
  });
});
