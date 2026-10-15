import { useCallback, useEffect, useRef, useState } from 'react';

import { cancelDetection, confirmDetection, getDetection, isTerminalDetectionStatus, pollDetection, rescanDetection, startDetection, type DetectionResult } from '../api';

export const MINIMUM_SCAN_MS = 5500;
export type DetectionPhase = 'idle' | 'loading' | 'scanning' | 'ready' | 'terminal' | 'submitting' | 'error';
interface UseDetectionRunOptions {
  snapshotHandle: string | null;
  runId: string | null;
  onRunIdChange?: (runId: string) => void;
}
interface Operation { controller: AbortController; kind: 'read' | 'start' | 'rescan' | 'confirm' | 'cancel' }

function sleep(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => { window.clearTimeout(timer); reject(new DOMException('The request was aborted.', 'AbortError')); };
    const timer = window.setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, milliseconds);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}

export function useDetectionRun({ snapshotHandle, runId, onRunIdChange }: UseDetectionRunOptions) {
  const [run, setRun] = useState<DetectionResult | null>(null);
  const [phase, setPhase] = useState<DetectionPhase>(runId ? 'loading' : 'idle');
  const [error, setError] = useState<string | null>(null);
  const [scanComplete, setScanComplete] = useState(false);
  const [busy, setBusy] = useState(Boolean(runId));
  const mounted = useRef(false);
  const active = useRef<Operation | null>(null);
  const ownedRoute = useRef<string | null>(null);
  const latest = useRef({ snapshotHandle, runId, onRunIdChange, run });
  latest.current = { snapshotHandle, runId, onRunIdChange, run };

  const current = useCallback((operation: Operation) => mounted.current && active.current === operation && !operation.controller.signal.aborted, []);

  const execute = useCallback((kind: Operation['kind'], targetId?: string, candidateIds: string[] = [], notDetected = false) => {
    if (!mounted.current || active.current) return;
    const operation: Operation = { kind, controller: new AbortController() };
    active.current = operation; // Synchronous lock: rapid clicks cannot duplicate a POST.
    const startedAt = Date.now();
    const signal = operation.controller.signal;
    setBusy(true);
    setError(null);
    setScanComplete(false);
    setPhase(kind === 'read' ? 'loading' : kind === 'confirm' || kind === 'cancel' ? 'submitting' : 'scanning');
    if (kind === 'start' || kind === 'rescan' || kind === 'read') setRun(null);

    void (async () => {
      try {
        const response = kind === 'read' ? await getDetection(targetId!, signal)
          : kind === 'start' ? await startDetection(latest.current.snapshotHandle!, signal)
            : kind === 'rescan' ? await rescanDetection(targetId!, signal)
              : kind === 'confirm' ? await confirmDetection(targetId!, candidateIds, notDetected, signal)
                : await cancelDetection(targetId!, signal);
        if (!current(operation)) return;
        if ((kind === 'read' || kind === 'confirm' || kind === 'cancel') && response.run.runId !== targetId) {
          throw new Error('The backend returned a different detection run. Reload this run to continue.');
        }
        let result = response.run;
        setRun(result);
        if (kind === 'start' || kind === 'rescan') {
          ownedRoute.current = result.runId;
          latest.current.onRunIdChange?.(result.runId);
        }
        if (!isTerminalDetectionStatus(result.status)) {
          setPhase('scanning');
          result = (await pollDetection(result.runId, {
            signal,
            onUpdate: (next) => { if (current(operation)) setRun(next); },
          })).run;
        }
        if (!current(operation)) return;
        setRun(result);
        // The scanner may finish early. Counters stay server-authored while the
        // honest completion message accounts for the deliberate review cadence.
        if (result.status === 'awaiting_confirmation' && kind !== 'confirm' && kind !== 'cancel') {
          const createdAt = Date.parse(result.createdAt);
          const start = kind === 'read' && Number.isFinite(createdAt) ? Math.min(startedAt, createdAt) : startedAt;
          const remaining = MINIMUM_SCAN_MS - (Date.now() - start);
          if (remaining > 0) {
            setScanComplete(true);
            setPhase('scanning');
            await sleep(remaining, signal);
          }
        }
        if (!current(operation)) return;
        setScanComplete(false);
        setPhase(result.status === 'awaiting_confirmation' || result.status === 'confirmed' ? 'ready' : 'terminal');
      } catch (reason: unknown) {
        if (!current(operation)) return;
        setScanComplete(false);
        setPhase('error');
        setError(reason instanceof Error ? reason.message : 'The detection request could not be completed.');
      } finally {
        if (current(operation)) { active.current = null; setBusy(false); }
      }
    })();
  }, [current]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      active.current?.controller.abort();
      active.current = null;
      ownedRoute.current = null;
    };
  }, []);

  useEffect(() => {
    if (runId && ownedRoute.current === runId) { ownedRoute.current = null; return; }
    active.current?.controller.abort();
    active.current = null;
    setRun(null);
    setScanComplete(false);
    setError(null);
    setBusy(Boolean(runId));
    setPhase(runId ? 'loading' : 'idle');
    if (runId) execute('read', runId);
  }, [execute, runId]);

  const start = useCallback(() => {
    if (latest.current.snapshotHandle && !latest.current.run && !latest.current.runId) execute('start');
  }, [execute]);
  const rescan = useCallback(() => {
    const previous = latest.current.run;
    if (previous && ['awaiting_confirmation', 'failed', 'cancelled'].includes(previous.status)) execute('rescan', previous.runId);
  }, [execute]);
  const confirm = useCallback((ids: string[], notDetected: boolean) => {
    const previous = latest.current.run;
    if (previous?.status !== 'awaiting_confirmation') return;
    const validIds = [...new Set(ids)].filter((id) => previous.candidates.some((candidate) => candidate.id === id));
    if (previous.candidates.length ? !validIds.length || notDetected : !notDetected || ids.length > 0) return;
    execute('confirm', previous.runId, validIds, notDetected);
  }, [execute]);
  const cancel = useCallback(() => {
    const previous = latest.current.run;
    if (!previous || isTerminalDetectionStatus(previous.status) || active.current?.kind === 'cancel' || active.current?.kind === 'confirm') return;
    active.current?.controller.abort();
    active.current = null;
    execute('cancel', previous.runId);
  }, [execute]);
  const reload = useCallback(() => { if (latest.current.runId) execute('read', latest.current.runId); }, [execute]);

  return { run, phase, error, busy, scanComplete, start, rescan, cancel, confirm, reload };
}
