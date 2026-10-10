import { NavLink, Navigate, Route, Routes } from 'react-router-dom';

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
              element={
                <PhasePage
                  title="Improve your project safely"
                  message="Connect a GitHub repository when you are ready. Analysis, repairs, and enhancements will always require review."
                />
              }
            />
            <Route
              path="/project/select"
              element={
                <PhasePage
                  title="Select a repository"
                  message="GitHub repository discovery will be enabled in a later part. No repositories are fabricated in the foundation."
                />
              }
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
      </div>
    </div>
  );
}
