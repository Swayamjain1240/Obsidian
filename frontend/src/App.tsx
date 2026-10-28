import { useEffect, useRef, type ReactNode } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';

import { CrystalCanvas } from './components/CrystalCanvas';
import { useAuthSession, type AuthSessionState } from './hooks/useAuthSession';
import { ConfirmationPage } from './pages/ConfirmationPage';
import { CompletenessPage } from './pages/CompletenessPage';
import { BaselinePage } from './pages/BaselinePage';
import { WorkflowPage } from './pages/WorkflowPage';
import { DetectionPage } from './pages/DetectionPage';
import { HealthPage } from './pages/HealthPage';
import { HomePage } from './pages/HomePage';
import { RepositoryPage } from './pages/RepositoryPage';
import { summary } from './components/PagedText';

const phases = [
  { path: '/home', label: 'Home', step: '•' },
  { path: '/project/select', label: 'Repository', step: '1' },
  { path: '/project/detect', label: 'Detection', step: '2' },
  { path: '/project/confirm', label: 'Confirmation', step: '3' },
  { path: '/project/completeness', label: 'Completeness', step: '4' },
  { path: '/project/baseline', label: 'Baseline', step: '5' },
  { path: '/project/repair', label: 'Repair review', step: '6' },
  { path: '/project/enhance', label: 'Enhancements', step: '7' },
  { path: '/project/delivery', label: 'Version 2', step: '8' },
  { path: '/health', label: 'Health · future', step: '+' },
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

/**
 * One navigation rendered for every viewport: a labelled sidebar when there is
 * room, and the same links as a horizontally scrollable step rail when there is
 * not. Both keep every phase reachable in one tap, so nothing hides behind a
 * menu or a dropdown.
 */
function PhaseNavigation() {
  const location = useLocation();
  const activeRef = useRef<HTMLAnchorElement | null>(null);
  const activePath = phases.find((phase) => location.pathname === phase.path)?.path ?? '/home';

  // Keep the current step visible in the rail after navigation or a reload.
  // Guarded because non-browser test environments do not implement scrolling.
  useEffect(() => {
    const element = activeRef.current;
    if (typeof element?.scrollIntoView === 'function') {
      element.scrollIntoView({ block: 'nearest', inline: 'center' });
    }
  }, [activePath]);

  return (
    <nav className="phase-nav" aria-label="Project phases">
      <span className="nav-caption">Workspace</span>
      {phases.map((phase) => {
        const isActivePath = phase.path === activePath;
        return (
          <NavLink
            aria-current={isActivePath ? 'page' : undefined}
            className={({ isActive }) => isActive ? 'phase-link active' : 'phase-link'}
            key={phase.path}
            ref={isActivePath ? activeRef : undefined}
            to={phase.path}
          >
            <span className="phase-index" aria-hidden="true">{phase.step}</span>
            <span className="phase-label">{phase.label}</span>
          </NavLink>
        );
      })}
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
        <div className="topbar-meta">
          <span className="safety-label"><span className="safety-dot" aria-hidden="true" />Original project stays safe</span>
          {session.status === 'authenticated' && session.user ? <span className="topbar-user">{summary(session.user.login, 20)}</span> : null}
        </div>
      </header>

      <div className="workspace">
        <PhaseNavigation />
        <main className="phase-main">
          <Routes>
            <Route path="/home" element={<HomePage session={session} onSignOut={onSignOut} />} />
            <Route path="/project/select" element={<ProtectedRoute session={session}><RepositoryPage /></ProtectedRoute>} />
            <Route path="/project/detect" element={<ProtectedRoute session={session}><DetectionPage /></ProtectedRoute>} />
            <Route path="/project/confirm" element={<ProtectedRoute session={session}><ConfirmationPage /></ProtectedRoute>} />
            <Route path="/project/completeness" element={<ProtectedRoute session={session}><CompletenessPage /></ProtectedRoute>} />
            <Route path="/project/baseline" element={<ProtectedRoute session={session}><BaselinePage /></ProtectedRoute>} />
            <Route path="/project/repair" element={<ProtectedRoute session={session}><WorkflowPage /></ProtectedRoute>} />
            <Route path="/project/enhance" element={<ProtectedRoute session={session}><WorkflowPage /></ProtectedRoute>} />
            <Route path="/project/delivery" element={<ProtectedRoute session={session}><WorkflowPage /></ProtectedRoute>} />
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
