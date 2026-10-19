import { useCallback, useMemo, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import { BaselineProgress } from '../components/BaselineProgress';
import { BaselineReviewPanel } from '../components/BaselineReviewPanel';
import type { RepositorySummary } from '../api';
import { useBaselineRun } from '../hooks/useBaselineRun';
import { useGsapReveal } from '../motion';

interface RouteState { repository?: RepositorySummary }

export function BaselinePage() {
  const location = useLocation();
  const navigate = useNavigate();
  const repository = (location.state as RouteState | null)?.repository;
  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const runId = params.get('runId');
  const completenessRunId = params.get('completenessRunId');
  const contentRef = useRef<HTMLElement>(null);
  useGsapReveal(contentRef);

  const updateRunId = useCallback((nextRunId: string) => {
    navigate({ pathname: location.pathname, search: `?runId=${encodeURIComponent(nextRunId)}&completenessRunId=${encodeURIComponent(completenessRunId!)}` }, { replace: true, state: { repository } });
  }, [completenessRunId, location.pathname, navigate, repository]);
  const baseline = useBaselineRun({ completenessRunId, runId, onRunIdChange: updateRunId });

  if (!completenessRunId) return (
    <section className="page-layout empty-page" aria-labelledby="baseline-title">
      <span className="eyebrow">Step 5 of 9</span>
      <h1 id="baseline-title">Choose a scope first.</h1>
      <p className="muted">Baseline checks start only after completeness review and explicit scope selection.</p>
      <Link className="primary-button" to="/project/completeness">Review completeness</Link>
    </section>
  );

  const run = baseline.run;
  const progress = Boolean(run && (run.status === 'failed' || run.status === 'cancelled'))
    || baseline.phase === 'loading' || baseline.phase === 'planning' || baseline.phase === 'running' || baseline.phase === 'error';

  return (
    <section ref={contentRef} className="page-layout baseline-layout" aria-labelledby="baseline-page-title">
      <div className="page-intro"><span className="eyebrow">Step 5 of 9 · baseline testing</span><h1 id="baseline-page-title">Validate what already exists.</h1></div>
      {!run ? (
        <section className="panel next-step-panel" aria-labelledby="baseline-start-title">
          <span className="panel-glyph" aria-hidden="true">◎</span>
          <h2 id="baseline-start-title">Run the selected baseline.</h2>
          <p className="muted">Obsidian discovers safe adapter commands, records unavailable checks explicitly, and runs bounded checks against the immutable snapshot. Raw command output is never returned.</p>
          <button className="primary-button" type="button" onClick={baseline.start} disabled={baseline.busy}>{baseline.busy ? 'Starting baseline…' : 'Start baseline checks'}</button>
          {baseline.error ? <p className="inline-error" role="alert">{baseline.error}</p> : null}
        </section>
      ) : progress ? (
        <BaselineProgress run={run} phase={baseline.phase} busy={baseline.busy} error={baseline.error} onCancel={baseline.cancel} onReload={baseline.reload} />
      ) : <><BaselineReviewPanel run={run} /><div className="workflow-actions">{run.status === 'failed' || run.status === 'partial' ? <Link className="primary-button" to={`/project/repair?baselineRunId=${encodeURIComponent(run.runId)}`}>Open repair review</Link> : null}{run.status === 'passed' || ((run.status === 'failed' || run.status === 'partial') && run.scopeMode === 'EXISTING_ONLY') ? <Link className="secondary-button" to={`/project/enhance?baselineRunId=${encodeURIComponent(run.runId)}`}>Analyze enhancements</Link> : null}{run.status === 'cancelled' ? <p className="muted">Baseline checks were cancelled. Restart baseline checks to continue.</p> : null}</div></>}
    </section>
  );
}
