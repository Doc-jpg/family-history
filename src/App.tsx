import { useEffect } from 'react';
import { NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { useStore } from './store/store';
import Home from './views/Home';
import TreeView from './views/TreeView';
import MapView from './views/MapView';
import TimelineView from './views/TimelineView';
import PersonView from './views/PersonView';
import Admin from './views/Admin';
import InviteView from './views/InviteView';
import RelationView from './views/RelationView';
import SignIn from './views/SignIn';
import PeopleSearch from './components/PeopleSearch';
import { AdminIcon, LinkIcon, MapIcon, TimeIcon, TreeIcon } from './components/Icons';

export function Mark({ color = 'currentColor' }: { color?: string }) {
  return (
    <svg className="mark" viewBox="0 0 32 32" aria-hidden="true">
      <path d="M16 30V14" stroke={color} strokeWidth="2.4" strokeLinecap="round" />
      <path d="M16 20c-4-1-8-4-9-9 5 0 9 3 9 9zm0-4c0-6 4-10 10-10-1 6-5 9-10 10z" fill={color} />
      <path d="M8 30h16" stroke={color} strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

export default function App() {
  const { ds, mode, auth, ready, saveError, backend } = useStore();
  const loc = useLocation();
  useEffect(() => {
    document.documentElement.dataset.theme = ds.settings.theme;
    const r = document.documentElement.style;
    r.setProperty('--paternal', ds.settings.colors.paternal);
    r.setProperty('--maternal', ds.settings.colors.maternal);
    r.setProperty('--self', ds.settings.colors.self);
    r.setProperty('--household', ds.settings.colors.household);
    r.setProperty('--unknown', ds.settings.colors.unknown);
  }, [ds.settings]);

  const isInvite = loc.pathname.startsWith('/invite');
  const gated = mode === 'cloud' && !isInvite && (auth.status !== 'signed-in' || !auth.admin);
  if (mode === 'cloud' && !isInvite && !ready) return <div className="page empty">Loading…</div>;
  return (
    <div className="app">
      <a className="skip" href="#main">Skip to content</a>
      <header className="topbar">
        <NavLink to="/" className="brand">
          <Mark color="var(--accent)" /> {ds.settings.familyName === 'Family' || isInvite ? 'Family History' : `${ds.settings.familyName} Family History`}
        </NavLink>
        {!isInvite && !gated && (
          <nav className="nav" aria-label="Main">
            <NavLink to="/tree"><TreeIcon />Tree</NavLink>
            <NavLink to="/map"><MapIcon />Map</NavLink>
            <NavLink to="/timeline"><TimeIcon />Timeline</NavLink>
            <NavLink to="/related"><LinkIcon />Related</NavLink>
            <NavLink to="/admin"><AdminIcon />Admin</NavLink>
          </nav>
        )}
        <span className="spacer" />
        {!isInvite && !gated && <PeopleSearch />}
        {saveError && <span className="pill dot bad" title={saveError}>Not saved</span>}
        <span className={`pill dot ${mode === 'cloud' ? 'ok' : 'warn'}`} title={mode === 'cloud' ? 'Saved to the family database' : 'Saved only in this browser until the cloud database is connected'}>
          {mode === 'cloud' ? 'Cloud' : 'Local draft'}
        </span>
        {mode === 'cloud' && auth.status === 'signed-in' && !isInvite && <button className="btn small" onClick={() => backend.signOut?.()} title={auth.email}>Sign out</button>}
      </header>
      {!isInvite && !gated && (
        <nav className="tabbar" aria-label="Main (phone)">
          <NavLink to="/tree"><TreeIcon />Tree</NavLink>
          <NavLink to="/map"><MapIcon />Map</NavLink>
          <NavLink to="/timeline"><TimeIcon />Timeline</NavLink>
          <NavLink to="/related"><LinkIcon />Related</NavLink>
          <NavLink to="/admin"><AdminIcon />Admin</NavLink>
        </nav>
      )}
      {gated ? <SignIn /> : (
      <div id="main" className="view-enter" key={loc.pathname.split('/').slice(0, 2).join('/')} style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/tree" element={<TreeView />} />
        <Route path="/map" element={<MapView />} />
        <Route path="/timeline" element={<TimelineView />} />
        <Route path="/related" element={<RelationView />} />
        <Route path="/person/:id" element={<PersonView />} />
        <Route path="/admin/*" element={<Admin />} />
        <Route path="/invite/:token" element={<InviteView />} />
        <Route path="*" element={<div className="page empty">Nothing here.</div>} />
      </Routes>
      </div>
      )}
      {!isInvite && (
        <footer className="footer">
          <span>Private family archive. Nothing here is public.</span>
          <span>{ds.people.filter((p) => !p.placeholder).length} people recorded, {ds.people.filter((p) => p.placeholder).length} slots waiting on facts.</span>
        </footer>
      )}
    </div>
  );
}
