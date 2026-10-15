import type { ReactNode } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';

import { CrystalCanvas } from './components/CrystalCanvas';
import { useAuthSession, type AuthSessionState } from './hooks/useAuthSession';
import { ConfirmationPage } from './pages/ConfirmationPage';
import { CompletenessPage } from './pages/CompletenessPage';
import { DetectionPage } from './pages/DetectionPage';
import { HealthPage } from './pages/HealthPage';
import { HomePage } from './pages/HomePage';
import { RepositoryPage } from './pages/RepositoryPage';
import { summary } from './components/PagedText';

const phases = [
  { path: '/home', label: 'Home', shortLabel: 'Home' },
  { path: '/project/select', label: 'Repository', shortLabel: '1 · Repository' },
  { path: '/project/detect', label: 'Detection', shortLabel: '2 · Detection' },
  { path: '/project/confirm', label: 'Confirmation', shortLabel: '3 · Confirmation' },
  { path: '/project/completeness', label: 'Completeness', shortLabel: '4 · Completeness' },
  { path: '/health', label: 'Health · future', shortLabel: 'Health · future' },
];

function ProtectedRoute({ session, children }: { session: AuthSessionState; children: ReactNode }) {
  if (session.status === 'loading') {
    return (
      <section className="page-layout loading-page" aria-live="polite">
        <span className="eyebrow">Secure workspace</span>
        <h1>Checking your session…</h1>
        <p className="muted">Protected project data is available only after GitHub authorization.</p>
      </section>
    );
  }

  if (session.status !== 'authenticated') return <Navigate replace to="/home" />;
  return <>{children}</>;
}

function WizardNavigation({ mobile = false }: { mobile?: boolean }) {
  const location = useLocation();
  const navigate = useNavigate();
  const currentPath = phases.find((phase) => location.pathname === phase.path)?.path ?? '/home';

  return mobile ? (
    <div className="mobile-nav">
      <label className="sr-only" htmlFor="wizard-step">Wizard step</label>
      <select id="wizard-step" value={currentPath} onChange={(event) => navigate(event.target.value)}>
        {phases.map((phase) => <option value={phase.path} key={phase.path}>{phase.shortLabel}</option>)}
      </select>
    </div>
  ) : (
      <nav className="phase-nav desktop-nav" aria-label="Project phases">
        <span className="nav-caption">Workspace</span>
        {phases.map((phase) => (
          <NavLink
            className={({ isActive }) => isActive ? 'phase-link active' : 'phase-link'}
            key={phase.path}
            to={phase.path}
          >
            <span className="phase-index" aria-hidden="true">{phase.path === '/home' ? '•' : phase.label.charAt(0)}</span>
            {phase.label}
          </NavLink>
        ))}
      </nav>
  );
}

function AppShell({ session, onSignOut }: { session: AuthSessionState; onSignOut: () => void }) {
  return (
    <div className="app-shell">
      <CrystalCanvas />
      <header className="topbar">
        <NavLink className="brand" to="/home" aria-label="Obsidian home">
          <span className="brand-mark" aria-hidden="true">O</span>
          <span>Obsidian</span>
        </NavLink>
        <WizardNavigation mobile />
        <div className="topbar-meta">
          <span className="safety-label"><span className="safety-dot" aria-hidden="true" />Original project stays safe</span>
          {session.status === 'authenticated' && session.user ? <span className="topbar-user">{summary(session.user.login, 20)}</span> : null}
        </div>
      </header>

      <div className="workspace">
        <WizardNavigation />
        <main className="phase-main">
          <Routes>
            <Route path="/home" element={<HomePage session={session} onSignOut={onSignOut} />} />
            <Route path="/project/select" element={<ProtectedRoute session={session}><RepositoryPage /></ProtectedRoute>} />
            <Route path="/project/detect" element={<ProtectedRoute session={session}><DetectionPage /></ProtectedRoute>} />
            <Route path="/project/confirm" element={<ProtectedRoute session={session}><ConfirmationPage /></ProtectedRoute>} />
            <Route path="/project/completeness" element={<ProtectedRoute session={session}><CompletenessPage /></ProtectedRoute>} />
            <Route path="/health" element={<ProtectedRoute session={session}><HealthPage /></ProtectedRoute>} />
            <Route path="*" element={<Navigate replace to="/home" />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

export function App() {
  const { session, signOut } = useAuthSession();
  return <AppShell session={session} onSignOut={() => void signOut()} />;
}
