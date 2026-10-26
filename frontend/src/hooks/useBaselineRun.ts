import { useCallback, useEffect, useRef, useState } from 'react';

import {
  cancelBaseline,
  getBaseline,
  isTerminalBaselineStatus,
  pollBaseline,
  startBaseline,
  type BaselineResult,
} from '../api';

export type BaselinePhase = 'idle' | 'loading' | 'planning' | 'running' | 'terminal' | 'submitting' | 'error';

interface UseBaselineRunOptions {
  completenessRunId: string | null;
  runId: string | null;
  onRunIdChange?: (runId: string) => void;
}

interface Operation {
  controller: AbortController;
  kind: 'read' | 'start' | 'cancel';
}

export function useBaselineRun({ completenessRunId, runId, onRunIdChange }: UseBaselineRunOptions) {
  const [run, setRun] = useState<BaselineResult | null>(null);
  const [phase, setPhase] = useState<BaselinePhase>(runId ? 'loading' : 'idle');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(Boolean(runId));
  const active = useRef<Operation | null>(null);
  const mounted = useRef(false);
  const ownedRoute = useRef<string | null>(null);
  const previousRoute = useRef<string | null | undefined>(undefined);
  const latest = useRef({ completenessRunId, runId, onRunIdChange, run });
  latest.current = { completenessRunId, runId, onRunIdChange, run };

  const current = useCallback((operation: Operation) => mounted.current && active.current === operation && !operation.controller.signal.aborted, []);

  const execute = useCallback((kind: Operation['kind'], targetId?: string) => {
    if (active.current) return;
    const operation: Operation = { kind, controller: new AbortController() };
    active.current = operation;
    const signal = operation.controller.signal;
    setBusy(true);
    setError(null);
    setPhase(kind === 'read' ? 'loading' : kind === 'cancel' ? 'submitting' : 'planning');
    if (kind === 'read' || kind === 'start') setRun(null);

    void (async () => {
      try {
        const response = kind === 'read' ? await getBaseline(targetId!, signal)
          : kind === 'start' ? await startBaseline(latest.current.completenessRunId!, signal)
            : await cancelBaseline(targetId!, signal);
        if (!current(operation)) return;
        if ((kind === 'read' || kind === 'cancel') && response.run.runId !== targetId) throw new Error('The backend returned a different baseline run. Reload this run to continue.');
        let result = response.run;
        setRun(result);
        if (!isTerminalBaselineStatus(result.status)) {
          setPhase(result.status === 'running' ? 'running' : 'planning');
          result = (await pollBaseline(result.runId, { signal, onUpdate: (next) => { if (current(operation)) setRun(next); } })).run;
        }
        if (!current(operation)) return;
        setRun(result);
        if (kind === 'start') {
          ownedRoute.current = result.runId;
          latest.current.onRunIdChange?.(result.runId);
        }
        setPhase('terminal');
      } catch (reason: unknown) {
        if (!current(operation)) return;
        setPhase('error');
        setError(reason instanceof Error ? reason.message : 'The baseline request could not be completed.');
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
    const initialRoute = previousRoute.current === undefined;
    if (!initialRoute && previousRoute.current === runId) return;
    previousRoute.current = runId;
    if (initialRoute) {
      if (runId) execute('read', runId);
      return;
    }
    if (runId && ownedRoute.current === runId) { ownedRoute.current = null; return; }
    if (active.current?.kind === 'start' && ownedRoute.current) return;
    active.current?.controller.abort();
    active.current = null;
    setRun(null);
    setError(null);
    setBusy(Boolean(runId));
    setPhase(runId ? 'loading' : 'idle');
    if (runId) execute('read', runId);
  }, [execute, runId]);

  const start = useCallback(() => {
    if (latest.current.completenessRunId && !latest.current.run && !latest.current.runId) execute('start');
  }, [execute]);
  const cancel = useCallback(() => {
    const previous = latest.current.run;
    if (!previous || isTerminalBaselineStatus(previous.status) || active.current?.kind === 'cancel') return;
    active.current?.controller.abort();
    active.current = null;
    execute('cancel', previous.runId);
  }, [execute]);
  const reload = useCallback(() => { if (latest.current.runId) execute('read', latest.current.runId); }, [execute]);

  return { run, phase, error, busy, start, cancel, reload };
}
