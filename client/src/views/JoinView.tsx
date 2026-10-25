import { useState } from 'react';
import type { Route } from '../App';

interface TeamInfo {
  id: 'A' | 'B';
  name: string;
  playerCount: number;
  players: string[];
}

interface SessionInfo {
  code: string;
  name: string;
  openJoin: boolean;
  teams: TeamInfo[];
}

/** Kandidatenbeitritt ueber Show-Code. Die Moderation gibt den Beitritt frei. */
export function JoinView({ route }: { route: Route }) {
  const [code, setCode] = useState('');
  const [info, setInfo] = useState<SessionInfo | null>(null);
  const [name, setName] = useState('');
  const [team, setTeam] = useState<'A' | 'B'>('A');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const lookup = async () => {
    setError(null);
    setBusy(true);
    try {
      const response = await fetch(`/api/public/sessions/${code.trim().toUpperCase()}`);
      if (!response.ok) {
        const payload = (await response.json()) as { message?: string };
        throw new Error(payload.message ?? 'Show nicht gefunden.');
      }
      setInfo((await response.json()) as SessionInfo);
    } catch (err) {
      setInfo(null);
      setError(err instanceof Error ? err.message : 'Fehler');
    } finally {
      setBusy(false);
    }
  };

  const join = async () => {
    setError(null);
    setBusy(true);
    try {
      const response = await fetch(`/api/public/sessions/${code.trim().toUpperCase()}/join`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, team }),
      });
      const payload = (await response.json()) as { token?: string; message?: string; playerId?: string };
      if (!response.ok || !payload.token) throw new Error(payload.message ?? 'Beitritt fehlgeschlagen.');
      sessionStorage.setItem('quiz34a.candidateTicket', payload.token);
      sessionStorage.setItem('quiz34a.candidateName', name);
      route.navigate('#/candidate');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fehler');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card" style={{ maxWidth: 620, margin: '0 auto' }}>
      <h1 style={{ marginTop: 0 }}>Als Kandidat beitreten</h1>
      <div className="field">
        <label htmlFor="code">Show-Code</label>
        <input
          id="code"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="z. B. K7M2QP"
          maxLength={8}
        />
      </div>
      <button onClick={lookup} disabled={busy || code.trim().length < 4}>
        Show suchen
      </button>

      {error && (
        <div className="notice error" style={{ marginTop: 14 }}>
          {error}
        </div>
      )}

      {info && (
        <div style={{ marginTop: 16 }}>
          <h3>{info.name}</h3>
          {!info.openJoin && (
            <div className="notice">
              Der Beitritt ist derzeit gesperrt. Die Moderation muss ihn freigeben.
            </div>
          )}
          <div className="grid two">
            {info.teams.map((t) => (
              <div key={t.id} className="card" style={{ marginBottom: 0 }}>
                <strong>{t.name}</strong>
                <p className="muted">{t.playerCount} Spieler</p>
                <ul className="player-list">
                  {t.players.map((p) => (
                    <li key={p}>
                      <span>{p}</span>
                    </li>
                  ))}
                  {t.players.length === 0 && <li className="muted">noch niemand</li>}
                </ul>
              </div>
            ))}
          </div>

          <div className="field" style={{ marginTop: 16 }}>
            <label htmlFor="name">Dein Name</label>
            <input id="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
          </div>
          <div className="field">
            <label>Team</label>
            <div className="row">
              {info.teams.map((t) => (
                <button
                  key={t.id}
                  className={team === t.id ? 'primary' : ''}
                  onClick={() => setTeam(t.id)}
                  type="button"
                >
                  {t.name}
                </button>
              ))}
            </div>
          </div>
          <button className="primary" onClick={join} disabled={busy || !info.openJoin || name.trim().length < 2}>
            Verbindlich beitreten
          </button>
        </div>
      )}
    </section>
  );
}
