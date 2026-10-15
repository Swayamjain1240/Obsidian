import { useEffect, useMemo, useState } from 'react';

import type { CompletenessAreaStatus, CompletenessResult } from '../api';
import { useViewport } from '../hooks/useViewport';
import { DetailPager, PagedText, summary } from './PagedText';
import { PanelTabs } from './PanelTabs';

function statusLabel(status: CompletenessAreaStatus | null): string {
  return status ? status.replaceAll('_', ' ') : 'Not detected';
}

function statusClass(status: CompletenessAreaStatus | null): string {
  return status === 'broken' || status === 'not_implemented' ? 'status-chip status-danger' : status === 'partial' || status === 'placeholder' || status === 'working_with_issues' ? 'status-chip status-warning' : 'status-chip';
}

export function CompletenessReviewPanel({ run }: { run: CompletenessResult }) {
  const viewport = useViewport();
  const [view, setView] = useState('areas');
  const [areaIndex, setAreaIndex] = useState(0);
  const [findingIndex, setFindingIndex] = useState(0);
  const area = run.areas[Math.min(areaIndex, Math.max(0, run.areas.length - 1))];
  const areaFindings = useMemo(() => run.findings.filter((finding) => finding.areaId === area?.id), [area?.id, run.findings]);
  const finding = areaFindings[Math.min(findingIndex, Math.max(0, areaFindings.length - 1))];
  useEffect(() => { setAreaIndex(0); setFindingIndex(0); setView('areas'); }, [run.runId]);
  useEffect(() => setFindingIndex(0), [area?.id]);

  return (
    <section className="panel completeness-panel" aria-labelledby="completeness-review-title">
      <div className="panel-heading">
        <h2 id="completeness-review-title">Review project completeness</h2>
        <span className={statusClass(run.projectStatus)}>{statusLabel(run.projectStatus)}</span>
      </div>
      <p className="muted">The scanner reports evidence from the immutable snapshot. It does not execute repository code or invent missing features.</p>
      <PanelTabs label="Completeness views" value={view} onChange={setView} tabs={[{ id: 'areas', label: 'Areas' }, { id: 'findings', label: 'Findings' }, { id: 'run', label: 'Run details' }]}>
        {view === 'areas' ? (
          <div className="completeness-browser">
            {run.areas.length ? (
              <>
                <label className="sr-only" htmlFor="completeness-area">Completeness area</label>
                <select id="completeness-area" value={areaIndex} onChange={(event) => setAreaIndex(Number(event.target.value))}>
                  {run.areas.map((item, index) => <option key={item.id} value={index}>{summary(item.name, 32)} · {statusLabel(item.status)}</option>)}
                </select>
                {area ? <DetailPager label="Completeness area" fields={[
                  { label: 'Status', value: statusLabel(area.status) },
                  { label: 'Summary', value: area.summary },
                  { label: 'Findings', value: `${area.findingIds.length}` },
                  { label: 'Affected paths', value: area.affectedPaths.length ? area.affectedPaths.join('\n') : 'None reported' },
                ]} /> : null}
              </>
            ) : <p className="muted">No completeness areas were reported.</p>}
          </div>
        ) : null}
        {view === 'findings' ? (
          <div className="completeness-browser">
            {run.findings.length ? (
              <>
                <label className="sr-only" htmlFor="completeness-finding">Completeness finding</label>
                <select id="completeness-finding" value={run.findings.indexOf(finding!)} onChange={(event) => {
                  const selected = run.findings[Number(event.target.value)];
                  setAreaIndex(Math.max(0, run.areas.findIndex((item) => item.id === selected?.areaId)));
                  setFindingIndex(0);
                }}>
                  {run.findings.map((item, index) => <option key={item.id} value={index}>{summary(item.kind, 30)} · {summary(item.affectedPaths[0] ?? 'No path', 28)}</option>)}
                </select>
                {finding ? <DetailPager label="Completeness finding" fields={[
                  { label: 'Status', value: statusLabel(finding.status) },
                  { label: 'Summary', value: finding.summary },
                  { label: 'Area', value: finding.areaId },
                  { label: 'Evidence', value: finding.evidenceRefs.map((ref) => `${ref.path}${ref.line ? `:${ref.line}` : ''}\n${ref.reason}`).join('\n\n') || 'None reported' },
                  { label: 'Affected paths', value: finding.affectedPaths.join('\n') || 'None reported' },
                ]} /> : null}
              </>
            ) : <p className="muted">No completeness findings were reported.</p>}
          </div>
        ) : null}
        {view === 'run' ? <DetailPager label="Completeness run detail" fields={[
          { label: 'Run ID', value: run.runId, code: true },
          { label: 'Detection run', value: run.detectionRunId, code: true },
          { label: 'Snapshot ID', value: run.snapshotId, code: true },
          { label: 'Base commit', value: run.baseCommit, code: true },
          { label: 'Progress', value: `Files inspected: ${run.progress.files}\nBytes read: ${run.progress.bytes}\nFindings: ${run.progress.findings}` },
          { label: 'Policy', value: run.policyVersion },
          ...(run.warning ? [{ label: 'Review note', value: run.warning }] : []),
        ]} /> : null}
      </PanelTabs>
      {!viewport.compact ? <span className="muted completeness-footnote">{run.findings.length} findings · {run.fileCount} files in snapshot · {run.scannedFileCount} files inspected</span> : null}
    </section>
  );
}
