import { isTerminalDetectionStatus, type DetectionResult } from '../api';
import type { DetectionPhase } from '../hooks/useDetectionRun';
import { DetailPager } from './PagedText';
import { ErrorPanel } from './ErrorPanel';

interface DetectionProgressProps {
  run: DetectionResult | null;
  phase: DetectionPhase;
  scanComplete: boolean;
  busy: boolean;
  error: string | null;
  onCancel?: () => void;
  onReload?: () => void;
  onRescan?: () => void;
}

export function DetectionProgress({ run, phase, scanComplete, busy, error, onCancel, onReload, onRescan }: DetectionProgressProps) {
  const failed = run?.status === 'failed' || run?.status === 'cancelled';
  if (error || failed) return (
    <ErrorPanel title={failed ? run.status === 'cancelled' ? 'Scan cancelled.' : 'Scan failed.' : 'Scan unavailable'} message={error ?? run?.error?.message ?? (run?.status === 'cancelled' ? 'This scan was cancelled. The original project is unchanged.' : 'The backend did not provide a failure explanation.')}>
      {onReload ? <button className="secondary-button" type="button" onClick={onReload} disabled={busy}>Reload run</button> : null}
      {failed && onRescan ? <button className="secondary-button" type="button" onClick={onRescan} disabled={busy}>Rescan snapshot</button> : null}
    </ErrorPanel>
  );

  return (
    <section className="scan-panel" aria-labelledby="scan-title">
      <div className="scan-heading"><h2 id="scan-title">{scanComplete ? 'Scan complete' : phase === 'loading' ? 'Loading scan' : phase === 'submitting' ? 'Saving request' : 'Reading the snapshot'}</h2></div>
      <p className="scan-status muted" role="status" aria-live="polite">{scanComplete ? 'Scan complete — review opens shortly' : run ? `Stage: ${run.status.replaceAll('_', ' ')}` : 'Waiting for the backend response.'}</p>
      {run ? <DetailPager label="Scan detail" fields={[
        { label: 'Progress', value: `Files inspected: ${run.progress.files}\nBytes read: ${run.progress.bytes}\nEvidence files: ${run.evidenceFileCount}` },
        { label: 'Reported stage', value: run.progress.stage },
        { label: 'Run ID', value: run.runId, code: true },
        { label: 'Snapshot ID', value: run.snapshotId, code: true },
        { label: 'Safety', value: 'The scanner reads the immutable snapshot. Your original project stays safe and unchanged.' },
      ]} /> : <div className="scan-placeholder" aria-hidden="true">◎</div>}
      {onCancel && run && !isTerminalDetectionStatus(run.status) ? <button className="secondary-button" type="button" onClick={onCancel} disabled={!busy || phase === 'submitting'}>Cancel</button> : null}
    </section>
  );
}
