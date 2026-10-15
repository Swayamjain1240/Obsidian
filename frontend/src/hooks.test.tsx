import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchRepositories, type DetectionResult } from './api';
import { useAuthSession } from './hooks/useAuthSession';
import { MINIMUM_SCAN_MS, useDetectionRun } from './hooks/useDetectionRun';

function response(payload: unknown, status = 200) { return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } }); }
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
async function flush() { await act(async () => { for (let i = 0; i < 12; i += 1) await Promise.resolve(); }); }
function run(status: DetectionResult['status'] = 'awaiting_confirmation', runId = 'run-1'): DetectionResult {
  return { runId, snapshotId: 'snapshot-1', baseCommit: 'original-commit', archiveSha256: 'original-hash', status, candidates: [{ id: 'typescript', language: 'TypeScript', frameworks: ['React'], packageManager: 'npm', evidenceStrength: 'strong', evidenceRefs: [{ path: 'package.json', reason: 'Declared dependency', kind: 'manifest' }], adapterAvailable: true }], primaryCandidateId: 'typescript', unknownReason: null, fileCount: 8, evidenceFileCount: 1, policyVersion: 'v1', progress: { stage: status, files: 8, bytes: 4096 }, createdAt: '2026-01-01T00:00:00.000Z' };
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); window.sessionStorage.clear(); });

describe('detection lifecycle boundaries', () => {
  it('creates once on rapid clicks, keeps honest completed progress for 5500ms, and does not touch the original project', async () => {
    vi.useFakeTimers();
    const scan = run();
    const fetchMock = vi.fn().mockResolvedValue(response({ run: scan, requestId: 'start-1' }));
    vi.stubGlobal('fetch', fetchMock);
    const onRunIdChange = vi.fn();
    const { result } = renderHook(() => useDetectionRun({ snapshotHandle: 'opaque-handle', runId: null, onRunIdChange }), { reactStrictMode: true });
    act(() => { result.current.start(); result.current.start(); });
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/intake/detections');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ snapshotHandle: 'opaque-handle' });
    expect(result.current).toMatchObject({ phase: 'scanning', scanComplete: true, busy: true });
    expect(result.current.run?.progress).toEqual(scan.progress);
    await act(async () => { await vi.advanceTimersByTimeAsync(MINIMUM_SCAN_MS - 1); });
    expect(result.current.phase).toBe('scanning');
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(result.current).toMatchObject({ phase: 'ready', busy: false, scanComplete: false });
    expect(result.current.run?.baseCommit).toBe('original-commit');
    expect(onRunIdChange).toHaveBeenCalledExactlyOnceWith('run-1');
  });

  it('reloads by GET under StrictMode and discards old route results even when fetch ignores abort', async () => {
    const old = deferred<Response>();
    const fetchMock = vi.fn().mockImplementation((input: string) => input.endsWith('/old') ? old.promise : Promise.resolve(response({ run: run('awaiting_confirmation', 'new') })));
    vi.stubGlobal('fetch', fetchMock);
    const { result, rerender } = renderHook(({ id }) => useDetectionRun({ snapshotHandle: null, runId: id }), { initialProps: { id: 'old' }, reactStrictMode: true });
    rerender({ id: 'new' });
    await flush();
    expect(result.current.run?.runId).toBe('new');
    old.resolve(response({ run: run('confirmed', 'old') }));
    await flush();
    expect(result.current.run?.runId).toBe('new');
    expect(result.current.phase).toBe('ready');
    expect(fetchMock.mock.calls.every((call) => !call[1]?.method)).toBe(true);
  });

  it('rescans valid candidates once, waits for the new run, and confirms selected IDs once', async () => {
    vi.useFakeTimers();
    const confirmed = deferred<Response>();
    const fetchMock = vi.fn().mockImplementation((input: string) => {
      if (input.endsWith('/rescan')) return Promise.resolve(response({ run: run('awaiting_confirmation', 'run-2') }));
      if (input.endsWith('/confirm')) return confirmed.promise;
      return Promise.resolve(response({ run: run() }));
    });
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useDetectionRun({ snapshotHandle: null, runId: 'run-1' }));
    await flush();
    act(() => { result.current.rescan(); result.current.rescan(); result.current.confirm(['typescript'], false); });
    await flush();
    expect(fetchMock.mock.calls.filter((call) => call[0].endsWith('/rescan'))).toHaveLength(1);
    expect(fetchMock.mock.calls.filter((call) => call[0].endsWith('/confirm'))).toHaveLength(0);
    expect(result.current.run?.runId).toBe('run-2');
    expect(result.current.scanComplete).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(MINIMUM_SCAN_MS); });
    act(() => { result.current.confirm(['typescript', 'typescript', 'not-reported'], false); result.current.confirm(['typescript'], false); });
    expect(fetchMock.mock.calls.filter((call) => call[0].endsWith('/confirm'))).toHaveLength(1);
    expect(JSON.parse(fetchMock.mock.calls.find((call) => call[0].endsWith('/confirm'))![1].body)).toEqual({ candidateIds: ['typescript'], notDetected: false });
    confirmed.resolve(response({ run: { ...run('confirmed', 'run-2'), confirmedCandidateIds: ['typescript'] } }));
    await flush();
    expect(result.current.run?.status).toBe('confirmed');
    expect(result.current.run?.snapshotId).toBe('snapshot-1');
    expect(result.current.run?.archiveSha256).toBe('original-hash');
  });

  it('cancels once while polling and ignores the superseded completed result', async () => {
    const poll = deferred<Response>();
    const cancelled = deferred<Response>();
    let reads = 0;
    const fetchMock = vi.fn().mockImplementation((input: string) => {
      if (input.endsWith('/cancel')) return cancelled.promise;
      reads += 1;
      return reads === 1 ? Promise.resolve(response({ run: run('extracting') })) : poll.promise;
    });
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useDetectionRun({ snapshotHandle: null, runId: 'run-1' }));
    await flush();
    act(() => { result.current.cancel(); result.current.cancel(); });
    expect(fetchMock.mock.calls.filter((call) => call[0].endsWith('/cancel'))).toHaveLength(1);
    cancelled.resolve(response({ run: run('cancelled') }));
    poll.resolve(response({ run: run('awaiting_confirmation') }));
    await flush();
    expect(result.current).toMatchObject({ phase: 'terminal', busy: false });
    expect(result.current.run?.status).toBe('cancelled');
  });

  it('does not retry failed POSTs or publish results after unmount', async () => {
    const pending = deferred<Response>();
    const fetchMock = vi.fn().mockReturnValue(pending.promise);
    vi.stubGlobal('fetch', fetchMock);
    const onRunIdChange = vi.fn();
    const { result, unmount } = renderHook(() => useDetectionRun({ snapshotHandle: 'handle', runId: null, onRunIdChange }));
    act(() => result.current.start());
    unmount();
    pending.reject(new Error('network disconnected'));
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
    expect(onRunIdChange).not.toHaveBeenCalled();
  });

  it('shows a failed scan immediately without the successful-completion delay', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ run: { ...run('failed'), error: { code: 'ARCHIVE_CHANGED', message: 'Archive verification failed.' } } })));
    const { result } = renderHook(() => useDetectionRun({ snapshotHandle: 'handle', runId: null }));
    act(() => result.current.start());
    await flush();
    expect(result.current).toMatchObject({ phase: 'terminal', scanComplete: false, busy: false });
    expect(result.current.run?.error?.message).toBe('Archive verification failed.');
  });
});

describe('session lifecycle boundaries', () => {
  it('uses the current session check after StrictMode remount and ignores a late authenticated result', async () => {
    const stale = deferred<Response>();
    const fetchMock = vi.fn().mockReturnValueOnce(stale.promise).mockResolvedValue(response({ error: { message: 'Session expired.' } }, 401));
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(useAuthSession, { reactStrictMode: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(result.current.session).toMatchObject({ status: 'unauthenticated', error: 'Session expired.' }));
    stale.resolve(response({ user: { id: 1, login: 'stale-user' }, configured: true }));
    await flush();
    expect(result.current.session.user).toBeNull();
  });

  it('refreshes the session by GET and prevents a late refresh from undoing one logout POST', async () => {
    const refresh = deferred<Response>();
    const signedOut = deferred<Response>();
    let checks = 0;
    const fetchMock = vi.fn().mockImplementation((input: string) => {
      if (input === '/auth/logout') return signedOut.promise;
      checks += 1;
      return checks === 1 ? Promise.resolve(response({ user: { id: 7, login: 'octocat' }, configured: true })) : refresh.promise;
    });
    vi.stubGlobal('fetch', fetchMock);
    window.sessionStorage.setItem('obsidian.snapshot', 'cached');
    const { result } = renderHook(useAuthSession);
    await flush();
    expect(result.current.session.status).toBe('authenticated');
    act(() => { void result.current.refresh(); void result.current.signOut(); void result.current.signOut(); });
    signedOut.resolve(new Response(null, { status: 204 }));
    await flush();
    refresh.resolve(response({ user: { id: 7, login: 'octocat' }, configured: true }));
    await flush();
    expect(result.current.session.status).toBe('unauthenticated');
    expect(fetchMock.mock.calls.filter((call) => call[0] === '/auth/logout')).toHaveLength(1);
    expect(window.sessionStorage.getItem('obsidian.snapshot')).toBeNull();
  });

  it('returns to the login boundary when a protected API reports expiry', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((input: string) => Promise.resolve(input === '/auth/me' ? response({ user: { id: 7, login: 'octocat' }, configured: true }) : response({ error: { code: 'SESSION_EXPIRED', message: 'Please sign in again.' } }, 401))));
    const { result } = renderHook(useAuthSession);
    await flush();
    await act(async () => { await expect(fetchRepositories()).rejects.toThrow('Please sign in again.'); });
    expect(result.current.session).toMatchObject({ status: 'unauthenticated', user: null, error: 'Please sign in again.' });
  });

  it('aborts logout on unmount and does not clear a later browser session', async () => {
    const pending = deferred<Response>();
    const fetchMock = vi.fn().mockImplementation((input: string) => input === '/auth/logout' ? pending.promise : Promise.resolve(response({ user: { id: 7, login: 'octocat' }, configured: true })));
    vi.stubGlobal('fetch', fetchMock);
    const { result, unmount } = renderHook(useAuthSession);
    await flush();
    act(() => { void result.current.signOut(); });
    unmount();
    window.sessionStorage.setItem('obsidian.snapshot', 'later-session');
    pending.resolve(new Response(null, { status: 204 }));
    await flush();
    expect(window.sessionStorage.getItem('obsidian.snapshot')).toBe('later-session');
    expect(fetchMock.mock.calls.find((call) => call[0] === '/auth/logout')![1].signal.aborted).toBe(true);
  });
});
