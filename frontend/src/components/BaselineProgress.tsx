import type { BaselineResult } from '../api';
import type { BaselinePhase } from '../hooks/useBaselineRun';
import { DetailPager } from './PagedText';
import { ErrorPanel } from './ErrorPanel';

export function BaselineProgress({ run, phase, busy, error, onCancel, onReload }: { run: BaselineResult | null; phase: BaselinePhase; busy: boolean; error: string | null; onCancel: () => void; onReload: () => void }) {
  const failed = run?.status === 'failed' || run?.status === 'partial' || run?.status === 'cancelled';
  if (error || failed) return (
    <ErrorPanel title={run?.status === 'cancelled' ? 'Baseline checks cancelled.' : run?.status === 'partial' ? 'Baseline evidence is incomplete.' : run?.status === 'failed' ? 'Baseline checks failed.' : 'Baseline checks unavailable'} message={error ?? run?.error?.message ?? run?.warning ?? 'The backend did not provide a failure explanation.'}>
      <button className="secondary-button" type="button" onClick={onReload} disabled={busy}>Reload baseline</button>
    </ErrorPanel>
  );
  return (
    <section className="scan-panel" aria-labelledby="baseline-progress-title">
      <div className="scan-heading"><h2 id="baseline-progress-title">{phase === 'loading' ? 'Loading baseline checks' : phase === 'planning' ? 'Planning baseline checks' : 'Running baseline checks'}</h2></div>
      <p className="scan-status muted" role="status" aria-live="polite">{run ? `Stage: ${run.status.replaceAll('_', ' ')}` : 'Waiting for the baseline worker.'}</p>
      {run ? <DetailPager label="Baseline progress" fields={[
        { label: 'Checks', value: `${run.progress.checksCompleted} of ${run.progress.checksTotal}` },
        { label: 'Passed', value: `${run.progress.passed}` },
        { label: 'Failed', value: `${run.progress.failed}` },
        { label: 'Not available', value: `${run.progress.notAvailable}` },
        { label: 'Run ID', value: run.runId, code: true },
        { label: 'Safety', value: 'Commands run with bounded time and output; raw command output is not returned.' },
      ]} /> : <div className="scan-placeholder" aria-hidden="true">◎</div>}
      {run && !failed ? <button className="secondary-button" type="button" onClick={onCancel} disabled={!busy}>Cancel</button> : null}
    </section>
  );
}
