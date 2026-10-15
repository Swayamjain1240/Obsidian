import { useEffect, useState } from 'react';

import type { DetectionCandidate, DetectionResult } from '../api';
import { useViewport } from '../hooks/useViewport';
import { DetailPager, PagedText, summary, type DetailField } from './PagedText';
import { PanelTabs } from './PanelTabs';

interface ConfirmationPanelProps {
  run: DetectionResult;
  selectedIds: string[];
  onToggle: (candidateId: string) => void;
  disabled?: boolean;
}

function candidateLabel(candidate: DetectionCandidate): string { return candidate.language ?? `Candidate ${candidate.id}`; }
function candidateFields(candidate: DetectionCandidate): DetailField[] {
  return [
    { label: 'Language', value: candidate.language ?? 'Not detected' },
    { label: 'Frameworks', value: candidate.frameworks.length ? candidate.frameworks.join('\n') : 'Not detected' },
    { label: 'Package manager', value: candidate.packageManager ?? 'Not detected' },
    { label: 'Evidence strength', value: candidate.evidenceStrength },
    { label: 'Adapter', value: candidate.adapterAvailable ? 'Available' : 'Not available' },
    { label: 'Candidate ID', value: candidate.id, code: true },
  ];
}

export function ConfirmationPanel({ run, selectedIds, onToggle, disabled = false }: ConfirmationPanelProps) {
  const viewport = useViewport();
  const perPage = viewport.compact ? 1 : 2;
  const [candidatePage, setCandidatePage] = useState(0);
  const [view, setView] = useState('stack');
  const [evidenceCandidate, setEvidenceCandidate] = useState(0);
  const [evidenceIndex, setEvidenceIndex] = useState(0);
  const pageCount = Math.max(1, Math.ceil(run.candidates.length / perPage));
  const page = Math.min(candidatePage, pageCount - 1);
  const visible = run.candidates.slice(page * perPage, (page + 1) * perPage);
  const evidenceOwner = run.candidates[Math.min(evidenceCandidate, Math.max(0, run.candidates.length - 1))];
  const reference = evidenceOwner?.evidenceRefs[Math.min(evidenceIndex, Math.max(0, evidenceOwner.evidenceRefs.length - 1))];

  useEffect(() => { setCandidatePage(0); setEvidenceCandidate(0); setEvidenceIndex(0); setView('stack'); }, [run.runId]);
  useEffect(() => setCandidatePage(0), [perPage]);

  const selection = (candidate: DetectionCandidate, compact = false) => (
    <label className="candidate-select">
      <input type="checkbox" checked={selectedIds.includes(candidate.id)} disabled={disabled} onChange={() => onToggle(candidate.id)} aria-label={`Select ${candidateLabel(candidate)}`} />
      <span>{compact ? 'Select' : summary(candidateLabel(candidate), 36)}</span>
    </label>
  );

  return (
    <section className="panel confirmation-panel" aria-labelledby="confirmation-title">
      <div className="panel-heading"><h2 id="confirmation-title">Confirm the detected stack</h2><span className="candidate-count">{run.candidates.length} candidates</span></div>
      <PanelTabs label="Review views" value={view} onChange={setView} tabs={[{ id: 'stack', label: 'Stack' }, { id: 'evidence', label: 'Evidence' }, { id: 'run', label: 'Run details' }]}>
        {view === 'stack' ? run.candidates.length === 0 ? (
          <div className="empty-detection" role="status"><strong>No candidates were detected.</strong><PagedText text={run.unknownReason ?? 'No reason was provided by the scanner. Use “Not detected” to record this result explicitly.'} label="Detection explanation" /></div>
        ) : viewport.compact ? (
          <div className="compact-candidate">
            <div className="candidate-toolbar">
              <label className="sr-only" htmlFor="candidate-picker">Candidate</label>
              <select id="candidate-picker" value={page} onChange={(event) => setCandidatePage(Number(event.target.value))}>
                {run.candidates.map((candidate, index) => <option key={candidate.id} value={index}>{index + 1}/{run.candidates.length} · {summary(candidateLabel(candidate), 28)}{selectedIds.includes(candidate.id) ? ' ✓' : ''}</option>)}
              </select>
              {visible[0] ? selection(visible[0], true) : null}
            </div>
            {visible[0] ? <DetailPager key={visible[0].id} fields={candidateFields(visible[0])} label="Candidate detail" /> : null}
          </div>
        ) : (
          <div className="candidate-browser">
            <div className="candidate-list" aria-label="Detected candidates">
              {visible.map((candidate) => <article key={candidate.id} className={selectedIds.includes(candidate.id) ? 'candidate-panel selected' : 'candidate-panel'}>{selection(candidate)}<DetailPager fields={candidateFields(candidate)} label={`${candidateLabel(candidate)} detail`} /></article>)}
            </div>
            <div className="pagination candidate-pagination" aria-label="Candidate pagination">
              <button className="pagination-button" type="button" onClick={() => setCandidatePage(Math.max(0, page - 1))} disabled={page === 0}>← Previous</button>
              <span className="pagination-label" aria-live="polite">Page {page + 1} of {pageCount}</span>
              <button className="pagination-button" type="button" onClick={() => setCandidatePage(Math.min(pageCount - 1, page + 1))} disabled={page + 1 === pageCount}>Next →</button>
            </div>
          </div>
        ) : null}

        {view === 'evidence' ? evidenceOwner ? (
          <div className="evidence-browser">
            <div className="evidence-toolbar">
              <label className="sr-only" htmlFor="evidence-candidate">Evidence candidate</label>
              <select id="evidence-candidate" value={evidenceCandidate} onChange={(event) => { setEvidenceCandidate(Number(event.target.value)); setEvidenceIndex(0); }}>
                {run.candidates.map((candidate, index) => <option key={candidate.id} value={index}>{index + 1} · {summary(candidateLabel(candidate), 28)}</option>)}
              </select>
              <label className="sr-only" htmlFor="evidence-reference">Evidence reference</label>
              <select id="evidence-reference" value={evidenceIndex} disabled={!evidenceOwner.evidenceRefs.length} onChange={(event) => setEvidenceIndex(Number(event.target.value))}>
                {evidenceOwner.evidenceRefs.length ? evidenceOwner.evidenceRefs.map((_, index) => <option key={index} value={index}>Reference {index + 1} / {evidenceOwner.evidenceRefs.length}</option>) : <option value={0}>No references</option>}
              </select>
            </div>
            {reference ? <DetailPager key={`${evidenceOwner.id}-${evidenceIndex}`} label="Evidence detail" fields={[{ label: 'File path', value: reference.path, code: true }, { label: 'Reason', value: reference.reason }, { label: 'Kind', value: reference.kind }]} /> : <p className="muted">No evidence references were reported.</p>}
          </div>
        ) : <p className="muted">No candidate evidence was reported.</p> : null}

        {view === 'run' ? <DetailPager label="Run detail" fields={[
          { label: 'Run ID', value: run.runId, code: true },
          { label: 'Snapshot ID', value: run.snapshotId, code: true },
          { label: 'Base commit', value: run.baseCommit, code: true },
          { label: 'Archive SHA-256', value: run.archiveSha256, code: true },
          { label: 'Policy version', value: run.policyVersion },
          { label: 'Primary candidate ID', value: run.primaryCandidateId ?? 'Not detected', code: Boolean(run.primaryCandidateId) },
          { label: 'Created', value: run.createdAt },
          { label: 'Files', value: `${run.fileCount} files inspected; ${run.evidenceFileCount} evidence files.` },
          { label: 'Scope and safety', value: 'Select only technologies supported by the reported evidence. Confirmation applies to this immutable snapshot; your original project stays safe. Completeness checks are a later phase.' },
          ...(run.unknownReason ? [{ label: 'Detection note', value: run.unknownReason }] : []),
          ...(run.analysisOnly ? [{ label: 'Analysis-only', value: 'The backend marked this run analysis-only.' }] : []),
        ]} /> : null}
      </PanelTabs>
    </section>
  );
}
