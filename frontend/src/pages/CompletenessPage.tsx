import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import { CompletenessProgress } from '../components/CompletenessProgress';
import { CompletenessReviewPanel } from '../components/CompletenessReviewPanel';
import { ScopePanel } from '../components/ScopePanel';
import { PanelTabs } from '../components/PanelTabs';
import { type RepositorySummary, type ScopeMode } from '../api';
import { useCompletenessRun } from '../hooks/useCompletenessRun';
import { useGsapReveal } from '../motion';
import { useViewport } from '../hooks/useViewport';
import { readDetectionContext, readSelectedRepository } from '../storage';

interface RouteState { repository?: RepositorySummary }

export function CompletenessPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const context = useMemo(() => readDetectionContext(), []);
  const storedRepository = useMemo(() => readSelectedRepository(), []);
  const repository = (location.state as RouteState | null)?.repository ?? context?.repository ?? storedRepository;
  const viewport = useViewport();
  const params = new URLSearchParams(location.search);
  const runId = params.get('runId');
  const detectionRunId = params.get('detectionRunId') ?? context?.run.runId ?? null;
  const [view, setView] = useState<'review' | 'scope'>('review');
  const contentRef = useRef<HTMLElement>(null);
  useGsapReveal(contentRef);

  const updateRunId = useCallback((nextRunId: string) => {
    navigate({ pathname: location.pathname, search: `?runId=${encodeURIComponent(nextRunId)}&detectionRunId=${encodeURIComponent(detectionRunId!)}` }, { replace: true, state: { repository } });
  }, [detectionRunId, location.pathname, navigate, repository]);
  const completeness = useCompletenessRun({ detectionRunId, runId, onRunIdChange: updateRunId });

  useEffect(() => {
    if (completeness.run?.status === 'awaiting_scope') setView('review');
    if (completeness.run?.status === 'scope_selected') setView('scope');
  }, [completeness.run?.status]);

  if (!detectionRunId) return (
    <section className="page-layout empty-page" aria-labelledby="completeness-title">
      <span className="eyebrow">Step 4 of 9</span>
      <h1 id="completeness-title">Confirm the stack first.</h1>
      <p className="muted">Completeness review is available only after stack confirmation on an immutable snapshot.</p>
      <Link className="primary-button" to="/project/select">Choose a repository</Link>
    </section>
  );

  const run = completeness.run;
  const readyForScope = run?.status === 'awaiting_scope';
  const scopeSelected = run?.status === 'scope_selected';
  const scope = run?.scopeMode as ScopeMode | undefined;

  return (
    <section ref={contentRef} className="page-layout completeness-layout" aria-labelledby="completeness-page-title">
      <div className="page-intro"><span className="eyebrow">Step 4 of 9 · completeness and scope</span><h1 id="completeness-page-title">Understand what already exists.</h1></div>
      {!run ? (
        <section className="panel next-step-panel" aria-labelledby="completeness-start-title">
          <span className="panel-glyph" aria-hidden="true">◌</span>
          <h2 id="completeness-start-title">Scan the confirmed snapshot.</h2>
          <p className="muted">Obsidian will look for evidence of TODOs, empty files, placeholders, missing configuration, broken relative imports, and partial areas. It will not execute repository code.</p>
          <button className="primary-button" type="button" onClick={completeness.start} disabled={completeness.busy}>{completeness.busy ? 'Starting review…' : 'Start completeness review'}</button>
          {completeness.error ? <p className="inline-error" role="alert">{completeness.error}</p> : null}
        </section>
      ) : run.status === 'failed' || run.status === 'cancelled' || completeness.phase === 'loading' || completeness.phase === 'scanning' || completeness.phase === 'error' ? (
        <CompletenessProgress run={run} phase={completeness.phase} busy={completeness.busy} error={completeness.error} onCancel={completeness.cancel} onReload={completeness.reload} />
      ) : (
        (() => {
          const reviewPanel = <CompletenessReviewPanel run={run} />;
          const scopePanel = readyForScope ? <ScopePanel busy={completeness.busy} onSelect={completeness.selectScope} /> : (
            <section className="panel locked-panel" aria-labelledby="scope-saved-title">
              <div className="panel-heading"><span className="locked-icon" aria-hidden="true">✓</span><h2 id="scope-saved-title">Scope selection is saved.</h2></div>
              <p className="muted">{scope === 'FULL' ? 'Complete project first' : 'Enhance existing parts only'} is recorded for the next baseline phase.</p>
               <Link className="primary-button" to={`/project/baseline?completenessRunId=${encodeURIComponent(run.runId)}`} state={{ repository }}>Start baseline checks</Link>
            </section>
          );
          return viewport.compact ? <PanelTabs label="Completeness steps" value={view} onChange={(value) => setView(value as 'review' | 'scope')} tabs={[{ id: 'review', label: 'Review' }, { id: 'scope', label: 'Scope' }]}>{view === 'review' ? reviewPanel : scopePanel}</PanelTabs> : <div className="completeness-columns">{reviewPanel}{scopePanel}</div>;
        })()
      )}
    </section>
  );
}
