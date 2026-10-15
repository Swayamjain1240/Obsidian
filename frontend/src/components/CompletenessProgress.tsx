import type { CompletenessResult } from '../api';
import type { CompletenessPhase } from '../hooks/useCompletenessRun';
import { DetailPager } from './PagedText';
import { ErrorPanel } from './ErrorPanel';

export function CompletenessProgress({ run, phase, busy, error, onCancel, onReload }: { run: CompletenessResult | null; phase: CompletenessPhase; busy: boolean; error: string | null; onCancel: () => void; onReload?: () => void }) {
  const failed = run?.status === 'failed' || run?.status === 'cancelled';
  if (error || failed) return (
    <ErrorPanel title={failed ? run.status === 'cancelled' ? 'Completeness review cancelled.' : 'Completeness review failed.' : 'Completeness review unavailable'} message={error ?? run?.error?.message ?? 'The backend did not provide a failure explanation.'}>
      {onReload ? <button className="secondary-button" type="button" onClick={onReload} disabled={busy}>Reload review</button> : null}
    </ErrorPanel>
  );
  return (
    <section className="scan-panel" aria-labelledby="completeness-progress-title">
      <div className="scan-heading"><h2 id="completeness-progress-title">{phase === 'loading' ? 'Loading completeness review' : phase === 'submitting' ? 'Saving scope' : 'Reviewing the snapshot'}</h2></div>
      <p className="scan-status muted" role="status" aria-live="polite">{run ? `Stage: ${run.status.replaceAll('_', ' ')}` : 'Waiting for the backend response.'}</p>
      {run ? <DetailPager label="Completeness progress" fields={[
        { label: 'Progress', value: `Files inspected: ${run.progress.files}\nBytes read: ${run.progress.bytes}\nFindings: ${run.progress.findings}` },
        { label: 'Stage', value: run.progress.stage },
        { label: 'Run ID', value: run.runId, code: true },
        { label: 'Snapshot ID', value: run.snapshotId, code: true },
        { label: 'Safety', value: 'The completeness scanner reads only the immutable snapshot and returns bounded evidence references.' },
      ]} /> : <div className="scan-placeholder" aria-hidden="true">◎</div>}
      {run && !failed && !['awaiting_scope', 'scope_selected'].includes(run.status) ? <button className="secondary-button" type="button" onClick={onCancel} disabled={!busy}>Cancel</button> : null}
    </section>
  );
}
