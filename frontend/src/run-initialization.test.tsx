import { useLayoutEffect, useRef } from 'react';
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useBaselineRun } from './hooks/useBaselineRun';
import { useCompletenessRun } from './hooks/useCompletenessRun';

function response(runId: string, status: string) {
  return new Response(JSON.stringify({ run: { runId, status }, requestId: 'test' }), { status: 200 });
}

const cases = [
  { phase: 'completeness', terminal: 'awaiting_scope', useRun: (runId: string | null, onRunIdChange?: (id: string) => void) => useCompletenessRun({ detectionRunId: 'detection', runId, onRunIdChange }) },
  { phase: 'baseline', terminal: 'passed', useRun: (runId: string | null, onRunIdChange?: (id: string) => void) => useBaselineRun({ completenessRunId: 'completeness', runId, onRunIdChange }) },
];

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe.each(cases)('$phase initialization', ({ phase, terminal, useRun }) => {
  it('preserves a start click before passive mount effects and polls exactly once', async () => {
    const endpoint = `/api/v1/intake/${phase}`;
    const fetchMock = vi.fn((input: RequestInfo | URL) => Promise.resolve(response('new-run', String(input) === endpoint ? 'queued' : terminal)));
    vi.stubGlobal('fetch', fetchMock);
    const onRunIdChange = vi.fn();
    function Page() {
      const run = useRun(null, onRunIdChange);
      return <><button onClick={run.start}>Start</button><output>{run.run?.status ?? 'idle'}</output></>;
    }
    function MountClick() {
      const container = useRef<HTMLDivElement>(null);
      // Deterministically exercise the observed click-before-passive-effects ordering.
      useLayoutEffect(() => { container.current!.querySelector('button')!.click(); }, []);
      return <div ref={container}><Page /></div>;
    }
    render(<MountClick />);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(terminal));
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([endpoint, `${endpoint}/new-run`]);
    expect(onRunIdChange).toHaveBeenCalledExactlyOnceWith('new-run');
  });

  it('aborts a superseded route and ignores its late result under StrictMode', async () => {
    let resolveOld!: (value: Response) => void;
    const old = new Promise<Response>((resolve) => { resolveOld = resolve; });
    const signals: AbortSignal[] = [];
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/old')) { signals.push(init!.signal!); return old; }
      return Promise.resolve(response('new', terminal));
    }));
    const { result, rerender, unmount } = renderHook(({ id }) => useRun(id), { initialProps: { id: 'old' }, reactStrictMode: true });
    rerender({ id: 'new' });
    await waitFor(() => expect(result.current.run?.runId).toBe('new'));
    expect(signals.length).toBeGreaterThan(0);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    await act(async () => { resolveOld(response('old', terminal)); });
    expect(result.current.run?.runId).toBe('new');
    unmount();
  });

  it('aborts an unfinished start on unmount without publishing a late result', async () => {
    let resolveStart!: (value: Response) => void;
    const pending = new Promise<Response>((resolve) => { resolveStart = resolve; });
    const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) => pending);
    vi.stubGlobal('fetch', fetchMock);
    const onRunIdChange = vi.fn();
    const { result, unmount } = renderHook(() => useRun(null, onRunIdChange));
    act(() => result.current.start());
    const signal = fetchMock.mock.calls[0][1]!.signal!;
    unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => { resolveStart(response('late', terminal)); });
    expect(onRunIdChange).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
