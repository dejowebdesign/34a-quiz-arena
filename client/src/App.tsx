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

/**
 * Rollen-Shell. Teilnehmer und Publikum sehen bewusst keine Navigation zur
 * Moderation oder Fragenverwaltung: ihre Oberflaeche bleibt auf die eigene
 * Quiz- beziehungsweise Uebertragungsansicht beschraenkt.
 */
type Chrome = 'full' | 'minimal' | 'none';

function chromeFor(path: string): Chrome {
  if (path.startsWith('/c/') || path.startsWith('/a/')) return 'none';
  if (path === '/candidate' || path === '/audience' || path === '/join') return 'minimal';
  return 'full';
}

/** Liest den Einladungspass aus einem Pfad wie "/c/<pass>" oder "/a/<pass>". */
export function passFromPath(path: string, prefix: string): string | null {
  if (!path.startsWith(prefix)) return null;
  const value = path.slice(prefix.length);
  return value.length > 0 ? value : null;
}

export function App() {
  const route = useHashRoute();
  const chrome = chromeFor(route.path);

  let page: JSX.Element;
  const candidatePass = passFromPath(route.path, '/c/');
  const audiencePass = passFromPath(route.path, '/a/');
  if (candidatePass) {
    page = <JoinView route={route} pass={candidatePass} />;
  } else if (audiencePass) {
    page = <AudienceView route={route} pass={audiencePass} />;
  } else if (route.path === '/join') {
    page = <JoinView route={route} pass={null} />;
  } else if (route.path === '/moderator') {
    page = <ModeratorView route={route} />;
  } else if (route.path === '/candidate') {
    page = <CandidateView route={route} />;
  } else if (route.path === '/audience') {
    page = <AudienceView route={route} pass={null} />;
  } else if (route.path === '/admin') {
    page = <AdminQuestions route={route} />;
  } else if (route.path.startsWith('/certificate/')) {
    page = <CertificatePage route={route} id={route.path.slice('/certificate/'.length)} />;
  } else {
    page = <HomeView route={route} />;
  }

  return (
    <div className={`app-shell chrome-${chrome}`}>
      {chrome !== 'none' && (
        <header className="topbar">
          <div className="brand">
            34A <span>Quiz Arena</span>
          </div>
          {chrome === 'full' && (
            <nav className="nav">
              {NAV.map((item) => (
                <a key={item.to} href={item.to} className={route.path === item.to.slice(1) ? 'active' : ''}>
                  {item.label}
                </a>
              ))}
            </nav>
          )}
          {chrome === 'minimal' && (
            <nav className="nav">
              <a href="#/">Start</a>
            </nav>
          )}
        </header>
      )}
      <main className="content">{page}</main>
    </div>
  );
}
