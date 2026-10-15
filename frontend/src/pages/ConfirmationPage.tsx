import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import { ConfirmationPanel } from '../components/ConfirmationPanel';
import { DetectionProgress } from '../components/DetectionProgress';
import { DetailPager } from '../components/PagedText';
import { useDetectionRun } from '../hooks/useDetectionRun';
import { useGsapReveal } from '../motion';
import { readDetectionContext, readSelectedRepository, saveDetectionContext } from '../storage';
import { isTerminalDetectionStatus, type RepositorySummary } from '../api';

interface RouteState { repository?: RepositorySummary }

export function ConfirmationPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const context = useMemo(() => readDetectionContext(), []);
  const storedRepository = useMemo(() => readSelectedRepository(), []);
  const repository = (location.state as RouteState | null)?.repository ?? context?.repository ?? storedRepository;
  const runId = new URLSearchParams(location.search).get('runId');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const contentRef = useRef<HTMLElement>(null);
  useGsapReveal(contentRef);

  const updateRunId = useCallback((nextRunId: string) => {
    navigate({ pathname: location.pathname, search: `?runId=${encodeURIComponent(nextRunId)}` }, { replace: true, state: { repository } });
  }, [location.pathname, navigate, repository]);
  const detection = useDetectionRun({ snapshotHandle: null, runId, onRunIdChange: updateRunId });
  useEffect(() => {
    if (!detection.run) return;
    const sameSnapshot = context?.snapshot?.snapshot.snapshotId === detection.run.snapshotId;
    saveDetectionContext({ run: detection.run, snapshotHandle: sameSnapshot ? context?.snapshotHandle ?? null : null, snapshot: sameSnapshot ? context?.snapshot ?? null : null, repository: sameSnapshot ? repository : (location.state as RouteState | null)?.repository ?? null });
  }, [context?.snapshot, context?.snapshotHandle, detection.run, location.state, repository]);
  useEffect(() => setSelectedIds([]), [detection.run?.runId]);
  const selectedCandidateIds = useMemo(() => {
    const valid = new Set(detection.run?.candidates.map((candidate) => candidate.id) ?? []);
    return selectedIds.filter((id) => valid.has(id));
  }, [detection.run?.candidates, selectedIds]);

  if (!runId) return (
      <section className="page-layout empty-page" aria-labelledby="confirmation-title">
       <span className="eyebrow">Step 3 of 6</span><h1 id="confirmation-title">No detection run selected.</h1>
      <p className="muted">Start a scan from an immutable snapshot before reviewing candidates.</p>
      <Link className="primary-button" to="/project/select">Choose a repository</Link>
    </section>
  );

  const run = detection.run;
  const progress = !run || !isTerminalDetectionStatus(run.status) || detection.phase === 'loading' || detection.phase === 'scanning' || Boolean(detection.error) || run.status === 'failed' || run.status === 'cancelled';
  const reviewing = !progress && run?.status === 'awaiting_confirmation';
  const locked = !progress && run?.status === 'confirmed';
  const noCandidates = run?.candidates.length === 0;
  const canConfirm = reviewing && !detection.busy && (noCandidates || selectedCandidateIds.length > 0);
  const toggle = (id: string) => setSelectedIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);

  return (
    <section ref={contentRef} className="page-layout confirmation-layout" aria-labelledby="confirmation-page-title">
       <div className="page-intro"><span className="eyebrow">Step 3 of 6 · confirmation</span><h1 id="confirmation-page-title">Review before moving on.</h1></div>
      <div className="confirmation-body">
        {progress ? <DetectionProgress run={run} phase={detection.phase} scanComplete={detection.scanComplete} busy={detection.busy} error={detection.error} onCancel={detection.cancel} onReload={detection.reload} onRescan={detection.rescan} /> : null}
        {run && reviewing ? <ConfirmationPanel run={run} selectedIds={selectedCandidateIds} onToggle={toggle} disabled={detection.busy} /> : null}
        {run && locked ? (
          <section className="panel locked-panel" aria-labelledby="locked-title">
            <div className="panel-heading"><span className="locked-icon" aria-hidden="true">✓</span><h2 id="locked-title" aria-live="polite">Stack confirmation is locked.</h2></div>
            <DetailPager label="Confirmation detail" fields={[
              { label: 'Next phase', value: 'Confirmation saved. Completeness review is the next gate. No health result or inferred technology is shown.' },
              { label: 'Confirmed candidates', value: run.confirmedCandidateIds?.length ? run.confirmedCandidateIds.join('\n') : 'Not detected' },
              { label: 'Run ID', value: run.runId, code: true },
              { label: 'Snapshot ID', value: run.snapshotId, code: true },
              { label: 'Original project', value: 'Your original project stays safe. Confirmation records your review; it does not change the source repository.' },
            ]} />
            <Link className="primary-button" to={`/project/completeness?detectionRunId=${encodeURIComponent(run.runId)}`} state={{ repository }}>Start completeness review</Link>
          </section>
        ) : null}
      </div>
      {run && reviewing ? (
        <div className="confirmation-actions">
          <button className="primary-button" type="button" onClick={() => { if (canConfirm) detection.confirm(selectedCandidateIds, Boolean(noCandidates)); }} disabled={!canConfirm}>{detection.phase === 'submitting' ? 'Saving confirmation…' : noCandidates ? 'Confirm: Not detected' : `Confirm ${selectedCandidateIds.length} selected`}</button>
          <button className="secondary-button" type="button" onClick={detection.rescan} disabled={detection.busy}>Rescan snapshot</button>
        </div>
      ) : null}
    </section>
  );
}
