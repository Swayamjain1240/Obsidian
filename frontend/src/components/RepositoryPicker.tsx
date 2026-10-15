import { useEffect, useRef, useState } from 'react';

import { fetchRepositories, type RepositorySummary } from '../api';
import { useViewport } from '../hooks/useViewport';
import { saveSelectedRepository } from '../storage';
import { DetailPager, summary } from './PagedText';
import { ErrorPanel } from './ErrorPanel';

const PAGE_SIZE = 5;
interface RepositoryPickerProps {
  compact?: boolean;
  onDismiss?: () => void;
  onSelect: (repository: RepositorySummary) => void;
}

export function RepositoryPicker({ compact = false, onDismiss, onSelect }: RepositoryPickerProps) {
  const viewport = useViewport();
  const preferredCount = viewport.short ? 1 : viewport.compact ? 3 : 5;
  const [capacity, setCapacity] = useState(preferredCount);
  const perView = Math.min(preferredCount, capacity);
  const resultsRef = useRef<HTMLDivElement>(null);
  const [repositories, setRepositories] = useState<RepositorySummary[]>([]);
  const [page, setPage] = useState(1);
  const [localPage, setLocalPage] = useState(0);
  const [details, setDetails] = useState<RepositorySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const requestRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const element = resultsRef.current;
    if (!element) return;
    const measure = () => {
      // A row has two bounded name lines, a metadata line and its 44px
      // details target. Leave room for wider system glyphs and browser zoom.
      setCapacity(element.clientHeight ? Math.max(1, Math.min(preferredCount, Math.floor((element.clientHeight + 8) / 108))) : preferredCount);
    };
    measure();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    observer?.observe(element);
    return () => observer?.disconnect();
  }, [preferredCount, details, error]);

  useEffect(() => {
    const controller = new AbortController();
    requestRef.current?.abort();
    requestRef.current = controller;
    setLoading(true);
    setError(null);
    setRepositories([]);
    setDetails(null);
    void fetchRepositories(page, PAGE_SIZE, controller.signal)
      .then((result) => { if (!controller.signal.aborted) setRepositories(result.repositories); })
      .catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Repositories are unavailable.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [page, reloadToken]);

  useEffect(() => setLocalPage(0), [perView]);
  const localCount = Math.max(1, Math.ceil(repositories.length / perView));
  const current = Math.min(localPage, localCount - 1);
  const choose = (repository: RepositorySummary) => { saveSelectedRepository(repository); onSelect(repository); };

  if (error) return <ErrorPanel title="Repositories unavailable" message={error}><button className="secondary-button" type="button" onClick={() => setReloadToken((value) => value + 1)}>Try again</button></ErrorPanel>;

  return (
    <section className={compact ? 'panel repository-picker compact' : 'panel repository-picker'} aria-labelledby="repository-picker-title">
      <div className="panel-heading">
        <h2 id="repository-picker-title">{details ? 'Repository details' : 'Choose a repository'}</h2>
        {details ? <button className="quiet-button" type="button" onClick={() => setDetails(null)}>Back to list</button> : onDismiss ? <button className="quiet-button" type="button" onClick={onDismiss} aria-label="Dismiss repository picker">Dismiss</button> : null}
      </div>
      {details ? (
        <>
          <DetailPager label="Repository detail" fields={[
            { label: 'Repository', value: details.full_name },
            { label: 'Branch', value: details.default_branch, code: true },
            { label: 'Language', value: details.language ?? 'Language not detected' },
            { label: 'Visibility', value: details.private ? 'Private' : 'Public' },
            { label: 'Updated', value: details.updated_at },
            { label: 'Repository ID', value: String(details.id), code: true },
          ]} />
          <button className="primary-button" type="button" onClick={() => choose(details)}>Select this repository</button>
        </>
      ) : (
        <>
          <div className="repository-results" ref={resultsRef}>
            {loading ? <p className="muted" role="status">Loading repositories from GitHub…</p> : null}
            {!loading && repositories.length === 0 ? <p className="empty-state">No repositories were returned for this page.</p> : null}
            <ul className="repository-list" aria-label="GitHub repositories">
              {repositories.slice(current * perView, (current + 1) * perView).map((repository) => (
                <li key={repository.id}>
                  <button className="repository-option" type="button" onClick={() => choose(repository)} aria-label={`Select ${repository.full_name}`}>
                    <span className="repository-main">
                      <strong>{summary(repository.full_name, viewport.compact ? 20 : 34)}</strong>
                      <span className="repository-meta">{repository.private ? 'Private' : 'Public'} · {summary(repository.language ?? 'Not detected', viewport.compact ? 8 : 16)}</span>
                    </span>
                    <span className="select-arrow" aria-hidden="true">→</span>
                  </button>
                  <button className="quiet-button repository-info" type="button" aria-label={`Details for ${repository.full_name}`} onClick={() => setDetails(repository)}>Details</button>
                </li>
              ))}
            </ul>
          </div>
          <div className="pagination" aria-label="Repository pagination">
            <button className="pagination-button" type="button" onClick={() => {
              if (current > 0) setLocalPage(current - 1);
              else { setLocalPage(Math.ceil(PAGE_SIZE / perView) - 1); setPage((value) => Math.max(1, value - 1)); }
            }} disabled={(page === 1 && current === 0) || loading}>← Previous</button>
            <span className="pagination-label" aria-live="polite">Page {page}{localCount > 1 ? ` · ${current + 1}/${localCount}` : ''}</span>
            <button className="pagination-button" type="button" onClick={() => {
              if (current + 1 < localCount) setLocalPage(current + 1);
              else { setLocalPage(0); setPage((value) => value + 1); }
            }} disabled={loading || (current + 1 === localCount && repositories.length < PAGE_SIZE)}>Next →</button>
          </div>
        </>
      )}
    </section>
  );
}
