import { useCallback, useEffect, useRef, useState } from 'react';

import {
  cancelCompleteness,
  getCompleteness,
  isTerminalCompletenessStatus,
  pollCompleteness,
  selectCompletenessScope,
  startCompleteness,
  type CompletenessResult,
  type ScopeMode,
} from '../api';

export type CompletenessPhase = 'idle' | 'loading' | 'scanning' | 'ready' | 'terminal' | 'submitting' | 'error';

interface UseCompletenessRunOptions {
  detectionRunId: string | null;
  runId: string | null;
  onRunIdChange?: (runId: string) => void;
}

interface Operation {
  controller: AbortController;
  kind: 'read' | 'start' | 'scope' | 'cancel';
}

export function useCompletenessRun({ detectionRunId, runId, onRunIdChange }: UseCompletenessRunOptions) {
  const [run, setRun] = useState<CompletenessResult | null>(null);
  const [phase, setPhase] = useState<CompletenessPhase>(runId ? 'loading' : 'idle');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(Boolean(runId));
  const active = useRef<Operation | null>(null);
  const mounted = useRef(false);
  const ownedRoute = useRef<string | null>(null);
  const previousRoute = useRef<string | null | undefined>(undefined);
  const latest = useRef({ detectionRunId, runId, onRunIdChange, run });
  latest.current = { detectionRunId, runId, onRunIdChange, run };

  const current = useCallback((operation: Operation) => mounted.current && active.current === operation && !operation.controller.signal.aborted, []);

  const execute = useCallback((kind: Operation['kind'], targetId?: string, scopeMode?: ScopeMode) => {
    if (active.current) return;
    const operation: Operation = { kind, controller: new AbortController() };
    active.current = operation;
    const signal = operation.controller.signal;
    setBusy(true);
    setError(null);
    setPhase(kind === 'read' ? 'loading' : kind === 'scope' || kind === 'cancel' ? 'submitting' : 'scanning');
    if (kind === 'start' || kind === 'read') setRun(null);

    void (async () => {
      try {
        const response = kind === 'read' ? await getCompleteness(targetId!, signal)
          : kind === 'start' ? await startCompleteness(latest.current.detectionRunId!, signal)
            : kind === 'scope' ? await selectCompletenessScope(targetId!, scopeMode!, signal)
              : await cancelCompleteness(targetId!, signal);
        if (!current(operation)) return;
        if ((kind === 'read' || kind === 'scope' || kind === 'cancel') && response.run.runId !== targetId) throw new Error('The backend returned a different completeness run. Reload this run to continue.');
        let result = response.run;
        setRun(result);
        if (!isTerminalCompletenessStatus(result.status) && result.status !== 'awaiting_scope') {
          setPhase('scanning');
          result = (await pollCompleteness(result.runId, { signal, onUpdate: (next) => { if (current(operation)) setRun(next); } })).run;
        }
        if (!current(operation)) return;
        setRun(result);
        if (kind === 'start') {
          ownedRoute.current = result.runId;
          latest.current.onRunIdChange?.(result.runId);
        }
        setPhase(result.status === 'awaiting_scope' || result.status === 'scope_selected' ? 'ready' : 'terminal');
      } catch (reason: unknown) {
        if (!current(operation)) return;
        setPhase('error');
        setError(reason instanceof Error ? reason.message : 'The completeness request could not be completed.');
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
    active.current?.controller.abort();
    active.current = null;
    setRun(null);
    setError(null);
    setBusy(Boolean(runId));
    setPhase(runId ? 'loading' : 'idle');
    if (runId) execute('read', runId);
  }, [execute, runId]);

  const start = useCallback(() => {
    if (latest.current.detectionRunId && !latest.current.run && !latest.current.runId) execute('start');
  }, [execute]);
  const selectScope = useCallback((mode: ScopeMode) => {
    const previous = latest.current.run;
    if (previous?.status !== 'awaiting_scope') return;
    execute('scope', previous.runId, mode);
  }, [execute]);
  const cancel = useCallback(() => {
    const previous = latest.current.run;
    if (!previous || isTerminalCompletenessStatus(previous.status) || active.current?.kind === 'cancel' || active.current?.kind === 'scope') return;
    active.current?.controller.abort();
    active.current = null;
    execute('cancel', previous.runId);
  }, [execute]);
  const reload = useCallback(() => { if (latest.current.runId) execute('read', latest.current.runId); }, [execute]);

  return { run, phase, error, busy, start, selectScope, cancel, reload };
}
