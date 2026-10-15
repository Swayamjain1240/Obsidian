import type { ScopeMode } from '../api';

export function ScopePanel({ busy, selected, onSelect }: { busy: boolean; selected?: ScopeMode; onSelect: (mode: ScopeMode) => void }) {
  return (
    <section className="panel scope-panel" aria-labelledby="scope-title">
      <div className="panel-heading"><h2 id="scope-title">Choose the next scope</h2><span className="eyebrow">Required gate</span></div>
      <p className="muted">Completeness found evidence to review. Choose whether the later baseline and enhancement phases may consider the complete project or only areas that already exist.</p>
      <div className="scope-options">
        <button className={selected === 'FULL' ? 'scope-option selected' : 'scope-option'} type="button" onClick={() => onSelect('FULL')} disabled={busy}>
          <strong>Complete project first</strong>
          <span>Keep the missing or partial areas in scope for a future completion plan before enhancement.</span>
        </button>
        <button className={selected === 'EXISTING_ONLY' ? 'scope-option selected' : 'scope-option'} type="button" onClick={() => onSelect('EXISTING_ONLY')} disabled={busy}>
          <strong>Enhance existing parts only</strong>
          <span>Exclude absent features and continue later only with already-created areas.</span>
        </button>
      </div>
      {selected ? <p className="scope-note" role="status">Scope saved as <strong>{selected === 'FULL' ? 'Complete project first' : 'Enhance existing parts only'}</strong>. Baseline checks are the next phase.</p> : null}
    </section>
  );
}
