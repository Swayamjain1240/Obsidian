import { useEffect, useState } from 'react';

import type { BaselineCheckStatus, BaselineResult } from '../api';
import { DetailPager, summary } from './PagedText';
import { PanelTabs } from './PanelTabs';

function statusLabel(status: BaselineCheckStatus): string {
  return status.replaceAll('_', ' ');
}

function statusClass(status: BaselineCheckStatus): string {
  if (status === 'failed' || status === 'timed_out') return 'status-chip status-danger';
  if (status === 'not_available' || status === 'skipped' || status === 'cancelled') return 'status-chip status-warning';
  if (status === 'passed') return 'status-chip status-success';
  return 'status-chip';
}

export function BaselineReviewPanel({ run }: { run: BaselineResult }) {
  const [view, setView] = useState('checks');
  const [checkIndex, setCheckIndex] = useState(0);
  const check = run.checks[Math.min(checkIndex, Math.max(0, run.checks.length - 1))];
  useEffect(() => { setView('checks'); setCheckIndex(0); }, [run.runId]);

  return (
    <section className="panel baseline-panel" aria-labelledby="baseline-review-title">
      <div className="panel-heading"><h2 id="baseline-review-title">Review baseline evidence</h2><span className={run.status === 'passed' ? 'status-chip status-success' : run.status === 'failed' ? 'status-chip status-danger' : 'status-chip status-warning'}>{run.status.replaceAll('_', ' ')}</span></div>
      <p className="muted">Baseline results describe commands that were available and executed against the immutable snapshot. A missing command is reported as Not available.</p>
      <PanelTabs label="Baseline views" value={view} onChange={setView} tabs={[{ id: 'checks', label: 'Checks' }, { id: 'run', label: 'Run details' }]}>
        {view === 'checks' ? (
          <div className="baseline-browser">
            {run.checks.length ? <>
              <label className="sr-only" htmlFor="baseline-check">Baseline check</label>
              <select id="baseline-check" value={checkIndex} onChange={(event) => setCheckIndex(Number(event.target.value))}>
                {run.checks.map((item, index) => <option key={item.id} value={index}>{summary(item.label, 34)} · {statusLabel(item.status)}</option>)}
              </select>
              {check ? <DetailPager label="Baseline check" fields={[
                { label: 'Status', value: statusLabel(check.status) },
                { label: 'Category', value: check.category },
                { label: 'Summary', value: check.summary },
                { label: 'Command', value: check.commandLabel ?? 'Not available' },
                { label: 'Exit code', value: check.exitCode === null ? 'Not run' : `${check.exitCode}` },
                { label: 'Duration', value: check.durationMs === null ? 'Not run' : `${check.durationMs} ms` },
                { label: 'Evidence', value: check.evidenceRefs.map((ref) => `${ref.path ?? 'manifest'}\n${ref.reason}`).join('\n\n') || 'None reported' },
              ]} /> : null}
            </> : <p className="muted">No baseline checks were planned.</p>}
          </div>
        ) : <DetailPager label="Baseline run detail" fields={[
          { label: 'Run ID', value: run.runId, code: true },
          { label: 'Completeness run', value: run.completenessRunId, code: true },
          { label: 'Snapshot ID', value: run.snapshotId, code: true },
          { label: 'Base commit', value: run.baseCommit, code: true },
          { label: 'Scope', value: run.scopeMode === 'FULL' ? 'Complete project first' : 'Enhance existing parts only' },
          { label: 'Next phase', value: run.nextPhase?.replaceAll('_', ' ') ?? 'Blocked until baseline evidence is complete' },
          ...(run.warning ? [{ label: 'Review note', value: run.warning }] : []),
        ]} />}
      </PanelTabs>
      <span className="muted completeness-footnote">{run.passedCount} passed · {run.failedCount} failed · {run.notAvailableCount} not available</span>
    </section>
  );
}
