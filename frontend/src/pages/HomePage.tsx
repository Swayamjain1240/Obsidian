import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import type { AuthSessionState } from '../hooks/useAuthSession';
import { useViewport } from '../hooks/useViewport';
import { useGsapReveal } from '../motion';
import { githubLoginUrl, selectRepository as selectRepositoryApi, type RepositorySummary } from '../api';
import { RepositoryPicker } from '../components/RepositoryPicker';
import { PanelTabs } from '../components/PanelTabs';
import { PagedText, summary } from '../components/PagedText';

interface HomePageProps { session: AuthSessionState; onSignOut: () => void }

export function HomePage({ session, onSignOut }: HomePageProps) {
  const navigate = useNavigate();
  const viewport = useViewport();
  const [pickerOpen, setPickerOpen] = useState(true);
  const [accountOpen, setAccountOpen] = useState(false);
  const [view, setView] = useState('welcome');
  const contentRef = useRef<HTMLElement>(null);
  useGsapReveal(contentRef);
  useEffect(() => { if (session.status === 'authenticated') setView('repositories'); else setView('welcome'); }, [session.status]);
  const selectRepository = async (repository: RepositorySummary) => { await selectRepositoryApi(repository); navigate('/project/detect', { state: { repository } }); };

  const welcome = (
    <div className="hero-copy">
      <span className="eyebrow">Review-first project enhancement</span>
      <h1 id="home-title">Improve your project safely</h1>
      {session.error ? <div className="home-error" role="alert"><PagedText text={session.error} label="Session error" /></div> : accountOpen && session.user ? <div className="account-details"><PagedText text={`GitHub login: ${session.user.login}\nUser ID: ${session.user.id}`} label="Account details" /></div> : <p className="hero-lede">Obsidian works from an immutable repository snapshot, shows its evidence, and waits for your approval before the next phase.</p>}
      {session.status === 'loading' ? <p className="muted" role="status">Checking your GitHub session…</p> : null}
      {session.status === 'authenticated' && session.user ? (
        <div className="signed-in-row">
          <button className="identity-pill" type="button" aria-label="View account details" aria-expanded={accountOpen} onClick={() => setAccountOpen((value) => !value)}>Signed in as <strong>{summary(session.user.login, 22)}</strong></button>
          <button className="quiet-button" type="button" onClick={onSignOut}>Sign out</button>
        </div>
      ) : session.configured ? <a className="primary-button" href={githubLoginUrl()}>Continue with GitHub</a> : <p className="message warning-message" role="status">GitHub sign-in is not configured for this environment.</p>}
      {viewport.compact && session.status !== 'authenticated' ? <p className="safety-caption">Your project stays yours.</p> : null}
    </div>
  );
  const project = session.status === 'authenticated' ? (
    pickerOpen ? <RepositoryPicker compact onDismiss={() => setPickerOpen(false)} onSelect={selectRepository} /> : (
      <section className="panel picker-dismissed" aria-label="Repository picker dismissed">
        <h2>Select a project when you are ready.</h2>
        <button className="secondary-button" type="button" onClick={() => setPickerOpen(true)}>Show repository picker</button>
      </section>
    )
  ) : (
    <section className="panel welcome-panel" aria-label="Welcome">
      <span className="panel-glyph" aria-hidden="true">✦</span>
      <h2>Your project stays yours.</h2>
      <p className="muted">No repository data is shown until GitHub authorizes this workspace. Your original project stays safe: scanning reads only an immutable snapshot.</p>
    </section>
  );

  return (
    <section ref={contentRef} className={viewport.compact ? 'page-layout home-layout compact-home' : 'page-layout home-layout'} aria-label="Project workspace">
      {viewport.compact ? <PanelTabs label="Home views" value={view} onChange={setView} tabs={[{ id: 'welcome', label: 'Welcome' }, { id: 'repositories', label: session.status === 'authenticated' ? 'Repositories' : 'Safety' }]}>{view === 'welcome' ? welcome : project}</PanelTabs> : <>{welcome}{project}</>}
    </section>
  );
}
