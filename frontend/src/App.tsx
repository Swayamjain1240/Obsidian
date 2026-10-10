import { useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';

import { fetchIntakeStatus, fetchRepositories, type IntakeStatus, type RepositorySummary } from './api';

const phases = [
  { path: '/home', label: 'Home' },
  { path: '/project/select', label: 'Repository' },
  { path: '/project/detect', label: 'Detection' },
  { path: '/project/confirm', label: 'Confirmation' },
  { path: '/health', label: 'Health Check' },
];

function PhasePage({ title, message }: { title: string; message: string }) {
  return (
    <section className="phase-card" aria-labelledby="phase-title">
      <span className="eyebrow">Part 1 foundation</span>
      <h1 id="phase-title">{title}</h1>
      <p>{message}</p>
      <div className="status-badge" role="status">
        Not implemented yet
      </div>
    </section>
  );
}

function FoundationStatus() {
  const [status, setStatus] = useState<IntakeStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchIntakeStatus().then(setStatus).catch(() => setError('Backend status unavailable.'));
  }, []);

  return (
    <aside className="foundation-status" aria-label="Foundation status">
      <strong>Foundation status</strong>
      {status ? <span>GitHub connection: {status.github}</span> : null}
      {status ? <span>AI analysis: {status.aiAnalysis}</span> : null}
      {error ? <span>{error}</span> : null}
    </aside>
  );
}

function HomePage() {
  return (
    <section className="phase-card" aria-labelledby="phase-title">
      <span className="eyebrow">Part 2 · GitHub OAuth App</span>
      <h1 id="phase-title">Improve your project safely</h1>
      <p>Sign in with GitHub to select a repository. Obsidian will not fabricate repositories or change your original project.</p>
      <a className="primary-action" href="/auth/github/start">Continue with GitHub</a>
      <NavLink className="secondary-action" to="/project/select">Open repository selection</NavLink>
    </section>
  );
}

function RepositoryPage() {
  const [repositories, setRepositories] = useState<RepositorySummary[]>([]);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetchRepositories(page)
      .then((result) => {
        setRepositories(result.repositories);
        setError(null);
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Repositories are unavailable.'))
      .finally(() => setLoading(false));
  }, [page]);

  return (
    <section className="phase-card repository-card" aria-labelledby="repository-title">
      <span className="eyebrow">Repository selection</span>
      <h1 id="repository-title">Choose a project</h1>
      {loading ? <p role="status">Loading your authorized repositories…</p> : null}
      {error ? <p className="inline-error" role="alert">{error}</p> : null}
      {!loading && !error && repositories.length === 0 ? <p>No repositories were returned for this page.</p> : null}
      <ul className="repository-list">
        {repositories.map((repository) => (
          <li key={repository.id}>
            <span>
              <strong>{repository.name}</strong>
              <small>{repository.language ?? 'Language not detected'} · {repository.private ? 'Private' : 'Public'}</small>
            </span>
            <button type="button" disabled>Coming soon</button>
          </li>
        ))}
      </ul>
      <div className="pagination" aria-label="Repository pagination">
        <button type="button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page === 1 || loading}>Previous</button>
        <span>Page {page}</span>
        <button type="button" onClick={() => setPage((current) => current + 1)} disabled={loading || repositories.length < 5}>Next</button>
      </div>
    </section>
  );
}

export function App() {
  return (
    <div className="app-shell">
      <header className="topbar">
        <NavLink className="brand" to="/home" aria-label="Obsidian home">
          <span className="brand-mark">O</span>
          <span>Obsidian</span>
        </NavLink>
        <span className="safety-label">Original project stays safe</span>
      </header>

      <div className="workspace">
        <nav className="phase-nav" aria-label="Project phases">
          {phases.map((phase) => (
            <NavLink
              className={({ isActive }) => (isActive ? 'phase-link active' : 'phase-link')}
              key={phase.path}
              to={phase.path}
            >
              {phase.label}
            </NavLink>
          ))}
        </nav>

        <main className="phase-main">
          <Routes>
            <Route
              path="/home"
              element={<HomePage />}
            />
            <Route
              path="/project/select"
              element={<RepositoryPage />}
            />
            <Route
              path="/project/detect"
              element={
                <PhasePage
                  title="Detect the project stack"
                  message="Detection will use repository evidence and ask for confirmation before continuing."
                />
              }
            />
            <Route
              path="/project/confirm"
              element={
                <PhasePage
                  title="Confirm detected technology"
                  message="Unknown technologies will remain not detected. Obsidian will never guess a language or framework."
                />
              }
            />
            <Route
              path="/health"
              element={
                <PhasePage
                  title="Check the existing project"
                  message="Baseline checks will run before any enhancement. Missing checks will be reported as not available."
                />
              }
            />
            <Route path="*" element={<Navigate replace to="/home" />} />
          </Routes>
        </main>
        <FoundationStatus />
      </div>
    </div>
  );
}
