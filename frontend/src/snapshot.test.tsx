import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DetectionPage } from './pages/DetectionPage';
import { MINIMUM_SCAN_MS } from './hooks/useDetectionRun';
import { readDetectionContext, readSelectedRepository, readSnapshot } from './storage';

vi.mock('./motion', () => ({ useGsapReveal: vi.fn() }));

const repository = { id: 1, name: 'project', full_name: 'owner/project', private: true, language: 'TypeScript', default_branch: 'main', html_url: 'https://github.com/owner/project', updated_at: '2026-01-01T00:00:00Z' };
const snapshot = { snapshotHandle: 'opaque-snapshot-handle', analysisStatus: 'not_started', snapshot: { snapshotId: 'snapshot-1', archiveSha256: 'sha-original', byteLength: 4096, capturedAt: '2026-01-01T00:00:00Z', immutable: true, repository: { owner: 'owner', name: 'project', branch: 'main', commitSha: 'commit-original' } } };
function response(payload: unknown) { return new Response(JSON.stringify(payload), { status: 200 }); }
async function flush() { await act(async () => { for (let i = 0; i < 12; i += 1) await Promise.resolve(); }); }
function renderPage() {
  return render(<MemoryRouter initialEntries={[{ pathname: '/project/detect', state: { repository } }]}><Routes><Route path="/project/detect" element={<DetectionPage />} /><Route path="/project/confirm" element={<h1>Review route opened</h1>} /></Routes></MemoryRouter>, { reactStrictMode: true });
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); window.sessionStorage.clear(); });

describe('immutable snapshot component flow', () => {
  it('creates one snapshot, starts one scan, and opens review only after the honest completion hold', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockImplementation((input: string) => Promise.resolve(input.endsWith('/snapshot') ? response({ intake: snapshot, requestId: 'snapshot-request' }) : response({ run: { runId: 'run-1', snapshotId: 'snapshot-1', baseCommit: 'commit-original', archiveSha256: 'sha-original', status: 'awaiting_confirmation', candidates: [], primaryCandidateId: null, unknownReason: 'No evidence.', fileCount: 2, evidenceFileCount: 0, policyVersion: 'v1', progress: { stage: 'evidence_finalized', files: 2, bytes: 4096 }, createdAt: new Date().toISOString() }, requestId: 'scan-request' })));
    vi.stubGlobal('fetch', fetchMock);
    renderPage();
    const create = screen.getByRole('button', { name: 'Create immutable snapshot' });
    act(() => { fireEvent.click(create); fireEvent.click(create); });
    await flush();
    expect(screen.getByRole('heading', { name: 'Snapshot ready' })).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ owner: 'owner', name: 'project', branch: 'main' });
    const start = screen.getByRole('button', { name: 'Start evidence scan' });
    act(() => { fireEvent.click(start); fireEvent.click(start); });
    await flush();
    expect(screen.getByRole('status')).toHaveTextContent('Scan complete — review opens shortly');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ snapshotHandle: 'opaque-snapshot-handle' });
    await act(async () => { await vi.advanceTimersByTimeAsync(MINIMUM_SCAN_MS - 1); });
    expect(screen.queryByRole('heading', { name: 'Review route opened' })).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(screen.getByRole('heading', { name: 'Review route opened' })).toBeTruthy();
    expect(readSnapshot()?.snapshot.repository.commitSha).toBe('commit-original');
    expect(readDetectionContext()?.run.archiveSha256).toBe('sha-original');
  });

  it('aborts an in-flight snapshot on unmount without persisting a late success', async () => {
    let resolve!: (response: Response) => void;
    const fetchMock = vi.fn().mockReturnValue(new Promise<Response>((yes) => { resolve = yes; }));
    vi.stubGlobal('fetch', fetchMock);
    const { unmount } = renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Create immutable snapshot' }));
    unmount();
    resolve(response({ intake: snapshot }));
    await flush();
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
    expect(readSnapshot()).toBeNull();
  });

  it('rejects damaged refresh hints instead of inventing project or snapshot data', () => {
    window.sessionStorage.setItem('obsidian.selectedRepository', '{bad-json');
    window.sessionStorage.setItem('obsidian.snapshot', JSON.stringify({ snapshot: {} }));
    window.sessionStorage.setItem('obsidian.detectionContext', JSON.stringify({ run: {} }));
    expect(readSelectedRepository()).toBeNull();
    expect(readSnapshot()).toBeNull();
    expect(readDetectionContext()).toBeNull();
  });
});
