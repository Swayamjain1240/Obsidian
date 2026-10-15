import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import { createRepositorySnapshot, type RepositorySummary, type SnapshotResult } from '../api';
import { DetectionProgress } from '../components/DetectionProgress';
import { DetailPager, PagedText } from '../components/PagedText';
import { PanelTabs } from '../components/PanelTabs';
import { useDetectionRun } from '../hooks/useDetectionRun';
import { useViewport } from '../hooks/useViewport';
import { useGsapReveal } from '../motion';
import { readDetectionContext, readSelectedRepository, readSnapshot, saveDetectionContext, saveSnapshot } from '../storage';

interface RouteState { repository?: RepositorySummary }
function matchingSnapshot(repository: RepositorySummary | null, snapshot: SnapshotResult | null): SnapshotResult | null {
  if (!repository || !snapshot?.snapshot?.repository) return null;
  return snapshot.snapshot.repository.owner === repository.full_name.split('/')[0] && snapshot.snapshot.repository.name === repository.name && snapshot.snapshot.repository.branch === repository.default_branch ? snapshot : null;
}

export function DetectionPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const viewport = useViewport();
  const storedContext = useMemo(() => readDetectionContext(), []);
  const storedRepository = useMemo(() => readSelectedRepository(), []);
  const repository = (location.state as RouteState | null)?.repository ?? storedRepository ?? storedContext?.repository ?? null;
  const runId = new URLSearchParams(location.search).get('runId');
  const [snapshot, setSnapshot] = useState<SnapshotResult | null>(() => matchingSnapshot(repository, storedContext?.snapshot ?? null) ?? matchingSnapshot(repository, readSnapshot()));
  const [snapshotBusy, setSnapshotBusy] = useState(false);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const [view, setView] = useState(runId ? 'scan' : 'snapshot');
  const contentRef = useRef<HTMLElement>(null);
  const snapshotController = useRef<AbortController | null>(null);
  useGsapReveal(contentRef);
  const snapshotHandle = snapshot?.snapshotHandle ?? (runId && storedContext?.run.runId === runId ? storedContext.snapshotHandle : null);
  const updateRunId = useCallback((nextRunId: string) => {
    navigate({ pathname: location.pathname, search: `?runId=${encodeURIComponent(nextRunId)}` }, { replace: true, state: { repository } });
  }, [location.pathname, navigate, repository]);
  const detection = useDetectionRun({ snapshotHandle, runId, onRunIdChange: updateRunId });

  useEffect(() => {
    if (detection.run) saveDetectionContext({ run: detection.run, snapshotHandle, snapshot, repository });
  }, [detection.run, repository, snapshot, snapshotHandle]);
  useEffect(() => {
    if (detection.phase === 'ready' && detection.run && ['awaiting_confirmation', 'confirmed'].includes(detection.run.status)) {
      navigate(`/project/confirm?runId=${encodeURIComponent(detection.run.runId)}`, { replace: true, state: { repository } });
    }
  }, [detection.phase, detection.run, navigate, repository]);
  useEffect(() => { if (detection.busy || detection.error) setView('scan'); }, [detection.busy, detection.error]);
  useEffect(() => {
    snapshotController.current?.abort();
    snapshotController.current = null;
    setSnapshot(matchingSnapshot(repository, readSnapshot()) ?? matchingSnapshot(repository, storedContext?.snapshot ?? null));
    setSnapshotBusy(false);
    setSnapshotError(null);
    return () => { snapshotController.current?.abort(); snapshotController.current = null; };
  }, [repository?.id, repository?.full_name, repository?.default_branch, storedContext]);

  const createSnapshot = async () => {
    if (!repository || snapshotController.current || snapshot) return;
    const owner = repository.full_name.split('/')[0];
    if (!owner) { setSnapshotError('The selected repository did not include an owner.'); return; }
    const controller = new AbortController();
    snapshotController.current = controller;
    setSnapshotBusy(true);
    setSnapshotError(null);
    try {
      const result = await createRepositorySnapshot({ owner, name: repository.name, branch: repository.default_branch }, controller.signal);
      if (!controller.signal.aborted && snapshotController.current === controller) { setSnapshot(result); saveSnapshot(result); }
    } catch (reason: unknown) {
      if (!controller.signal.aborted) setSnapshotError(reason instanceof Error ? reason.message : 'The snapshot could not be created.');
    } finally {
      if (!controller.signal.aborted) setSnapshotBusy(false);
      if (snapshotController.current === controller) snapshotController.current = null;
    }
  };

  if (!repository && !runId) return (
       <section className="page-layout empty-page" aria-labelledby="detection-title">
      <span className="eyebrow">Step 2 of 3</span><h1 id="detection-title">Select a repository first.</h1>
      <p className="muted">Choose an authorized repository to create an immutable snapshot.</p>
      <Link className="primary-button" to="/project/select">Open repository selection</Link>
    </section>
  );

  const snapshotPanel = (
    <section className="panel snapshot-panel" aria-labelledby="snapshot-title">
      <div className="panel-heading"><h2 id="snapshot-title">{snapshot ? 'Snapshot ready' : 'Create a safe snapshot'}</h2>{snapshot ? <span className="locked-chip">Immutable</span> : null}</div>
      {snapshotError ? <div className="error-content" role="alert"><PagedText text={snapshotError} label="Snapshot error" /></div> : <DetailPager label="Snapshot detail" fields={[
        { label: 'Repository', value: repository?.full_name ?? 'Repository metadata is unavailable. The existing run is loaded by its ID.' },
        ...(repository ? [{ label: 'Branch', value: repository.default_branch, code: true }] : []),
        ...(snapshot ? [
          { label: 'Snapshot ID', value: snapshot.snapshot.snapshotId, code: true },
          { label: 'Commit', value: snapshot.snapshot.repository.commitSha, code: true },
          { label: 'Archive SHA-256', value: snapshot.snapshot.archiveSha256, code: true },
          { label: 'Archive size', value: `${snapshot.snapshot.byteLength} bytes` },
          { label: 'Captured', value: snapshot.snapshot.capturedAt },
        ] : []),
        { label: 'Safety', value: 'Creating a snapshot does not change the source repository. The scanner reads only the captured archive and its recorded commit, after you start the evidence scan.' },
      ]} />}
      <div className="panel-actions">
        {!snapshot && repository ? <button className="primary-button" type="button" onClick={() => void createSnapshot()} disabled={snapshotBusy}>{snapshotBusy ? 'Creating snapshot…' : 'Create immutable snapshot'}</button> : null}
        {snapshot && !runId ? <button className="primary-button" type="button" onClick={detection.start} disabled={!snapshotHandle || detection.busy}>Start evidence scan</button> : null}
        {snapshot && !snapshotHandle ? <span className="inline-error" role="alert">Snapshot handle missing. Select the repository again.</span> : null}
        {snapshotError ? <button className="quiet-button" type="button" onClick={() => setSnapshotError(null)}>Back to details</button> : null}
      </div>
    </section>
  );
  const progressPanel = detection.phase !== 'idle' || runId ? <DetectionProgress run={detection.run} phase={detection.phase} scanComplete={detection.scanComplete} busy={detection.busy} error={detection.error} onCancel={detection.cancel} onReload={runId ? detection.reload : undefined} onRescan={detection.rescan} /> : (
    <section className="panel next-step-panel" aria-label="Next step"><span className="panel-glyph" aria-hidden="true">◎</span><h2>Evidence stays visible.</h2><p className="muted">Create a snapshot, then start the evidence scan. Review each candidate and its file evidence before confirming.</p></section>
  );
  return (
    <section ref={contentRef} className="page-layout detection-layout" aria-labelledby="detection-title">
       <div className="page-intro"><span className="eyebrow">Step 2 of 5 · read-only intake</span><h1 id="detection-title">Inspect an immutable snapshot.</h1></div>
      {viewport.compact ? <PanelTabs label="Intake views" value={view} onChange={setView} tabs={[{ id: 'snapshot', label: 'Snapshot' }, { id: 'scan', label: 'Scan' }]}>{view === 'snapshot' ? snapshotPanel : progressPanel}</PanelTabs> : <div className="detection-columns">{snapshotPanel}{progressPanel}</div>}
    </section>
  );
}
