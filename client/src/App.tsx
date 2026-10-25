import { useEffect, useState } from 'react';
import { HomeView } from './views/Home';
import { JoinView } from './views/JoinView';
import { ModeratorView } from './views/ModeratorView';
import { CandidateView } from './views/CandidateView';
import { AudienceView } from './views/AudienceView';
import { AdminQuestions } from './views/AdminQuestions';
import { CertificatePage } from './views/CertificatePage';

export interface Route {
  path: string;
  query: URLSearchParams;
  navigate: (to: string) => void;
}

/** Minimaler Hash-Router - bewusst ohne zusaetzliche Abhaengigkeit. */
export function useHashRoute(): Route {
  const [hash, setHash] = useState(() => window.location.hash || '#/');
  useEffect(() => {
    const onChange = () => setHash(window.location.hash || '#/');
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  const [path, search] = raw.split('?');
  return {
    path: path && path.length > 0 ? path : '/',
    query: new URLSearchParams(search ?? ''),
    navigate: (to: string) => {
      window.location.hash = to;
    },
  };
}

const NAV = [
  { to: '#/', label: 'Start' },
  { to: '#/join', label: 'Kandidat werden' },
  { to: '#/audience', label: 'Publikum' },
  { to: '#/moderator', label: 'Moderation' },
  { to: '#/admin', label: 'Fragenverwaltung' },
];

export function App() {
  const route = useHashRoute();

  let page: JSX.Element;
  if (route.path === '/join') {
    page = <JoinView route={route} />;
  } else if (route.path === '/moderator') {
    page = <ModeratorView route={route} />;
  } else if (route.path === '/candidate') {
    page = <CandidateView route={route} />;
  } else if (route.path === '/audience') {
    page = <AudienceView route={route} />;
  } else if (route.path === '/admin') {
    page = <AdminQuestions route={route} />;
  } else if (route.path.startsWith('/certificate/')) {
    page = <CertificatePage route={route} id={route.path.slice('/certificate/'.length)} />;
  } else {
    page = <HomeView route={route} />;
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          34A <span>Quiz Arena</span>
        </div>
        <nav className="nav">
          {NAV.map((item) => (
            <a key={item.to} href={item.to} className={route.path === item.to.slice(1) ? 'active' : ''}>
              {item.label}
            </a>
          ))}
        </nav>
      </header>
      <main className="content">{page}</main>
    </div>
  );
}
