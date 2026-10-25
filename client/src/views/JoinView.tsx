import { useEffect, useState } from 'react';
import type { Route } from '../App';

interface InviteInfo {
  sessionCode: string;
  sessionName: string;
  openJoin: boolean;
  suggestedTeam: 'A' | 'B' | null;
  teams: { id: 'A' | 'B'; name: string; playerCount: number }[];
}

/**
 * Kandidatenbeitritt. Im Regelfall erfolgt der Zugang ueber einen signierten
 * Einladungslink (`#/c/<pass>`); dann sind weder Show-Code noch PIN noetig.
 * Nur falls der Pass fehlt, wird ersatzweise der Show-Code abgefragt.
 */
export function JoinView({ route, pass }: { route: Route; pass: string | null }) {
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [name, setName] = useState(sessionStorage.getItem('quiz34a.candidateName') ?? '');
  const [team, setTeam] = useState<'A' | 'B' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Ersatzweg ohne Einladungslink: Show-Code manuell eingeben.
  const [code, setCode] = useState('');
  const [codeInfo, setCodeInfo] = useState<{ code: string; name: string; openJoin: boolean } | null>(null);

  useEffect(() => {
    if (!pass) return;
    let cancelled = false;
    setBusy(true);
    setError(null);
    fetch(`/api/public/invite/${encodeURIComponent(pass)}`)
      .then(async (response) => {
        if (!response.ok) {
          const payload = (await response.json()) as { message?: string };
          throw new Error(payload.message ?? 'Einladung ungueltig.');
        }
        return (await response.json()) as InviteInfo;
      })
      .then((payload) => {
        if (cancelled) return;
        setInfo(payload);
        setTeam(payload.suggestedTeam ?? payload.teams[0]?.id ?? 'A');
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pass]);

  const lookupCode = async () => {
    setError(null);
    setBusy(true);
    try {
      const response = await fetch(`/api/public/sessions/${code.trim().toUpperCase()}`);
      if (!response.ok) {
        const payload = (await response.json()) as { message?: string };
        throw new Error(payload.message ?? 'Show nicht gefunden.');
      }
      const payload = (await response.json()) as { code: string; name: string; openJoin: boolean };
      setCodeInfo(payload);
    } catch (err) {
      setCodeInfo(null);
      setError(err instanceof Error ? err.message : 'Fehler');
    } finally {
      setBusy(false);
    }
  };

  const join = async () => {
    setError(null);
    setBusy(true);
    try {
      const endpoint = pass
        ? `/api/public/join/${encodeURIComponent(pass)}`
        : `/api/public/sessions/${code.trim().toUpperCase()}/join`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, team }),
      });
      const payload = (await response.json()) as { token?: string; message?: string };
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

  // --- Fall ohne Einladungspass: Show-Code als Ersatzweg -------------------
  if (!pass) {
    return (
      <section className="card" style={{ maxWidth: 620, margin: '0 auto' }}>
        <h1 style={{ marginTop: 0 }}>Als Kandidat beitreten</h1>
        <p className="muted">
          Im Regelfall erhaeltst du von der Moderation einen Einladungslink. Damit geht es direkt weiter, ohne
          Show-Code. Ohne Link kannst du den Show-Code hier eingeben.
        </p>
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
        <button onClick={lookupCode} disabled={busy || code.trim().length < 4}>
          Show suchen
        </button>

        {error && (
          <div className="notice error" style={{ marginTop: 14 }}>
            {error}
          </div>
        )}

        {codeInfo && (
          <div style={{ marginTop: 16 }}>
            <h3>{codeInfo.name}</h3>
            {!codeInfo.openJoin && (
              <div className="notice">Der Beitritt ist derzeit gesperrt. Die Moderation muss ihn freigeben.</div>
            )}
            <div className="field" style={{ marginTop: 16 }}>
              <label htmlFor="name-code">Dein Name</label>
              <input id="name-code" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
            </div>
            <div className="field">
              <label>Team</label>
              <div className="row">
                {(['A', 'B'] as const).map((id) => (
                  <button key={id} className={team === id ? 'primary' : ''} onClick={() => setTeam(id)} type="button">
                    Team {id}
                  </button>
                ))}
              </div>
            </div>
            <button
              className="primary"
              onClick={join}
              disabled={busy || !codeInfo.openJoin || name.trim().length < 2 || team === null}
            >
              Verbindlich beitreten
            </button>
          </div>
        )}
      </section>
    );
  }

  // --- Regelfall: Einladungslink -------------------------------------------
  if (error && !info) {
    return (
      <section className="card" style={{ maxWidth: 520, margin: '0 auto' }}>
        <h1 style={{ marginTop: 0 }}>Einladung nicht gueltig</h1>
        <div className="notice error">{error}</div>
        <p className="muted">
          Der Link ist abgelaufen oder wurde von der Moderation widerrufen. Bitte einen neuen Link anfordern.
        </p>
        <button onClick={() => route.navigate('#/')}>Zur Startseite</button>
      </section>
    );
  }

  if (!info) {
    return (
      <section className="card" style={{ maxWidth: 520, margin: '0 auto' }}>
        <p className="muted">Einladung wird geprueft ...</p>
      </section>
    );
  }

  return (
    <section className="card join-card" style={{ maxWidth: 560, margin: '0 auto' }}>
      <h1 style={{ marginTop: 0 }}>Willkommen bei {info.sessionName}</h1>
      <p className="muted">Gib deinen Namen ein und waehle dein Team. Danach geht es direkt zur Quizansicht.</p>

      {!info.openJoin && (
        <div className="notice">Der Beitritt ist noch gesperrt. Die Moderation gibt ihn gleich frei.</div>
      )}

      <div className="field" style={{ marginTop: 14 }}>
        <label htmlFor="name">Dein Name</label>
        <input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={40}
          autoComplete="name"
          inputMode="text"
        />
      </div>

      <div className="field">
        <label>Team</label>
        <div className="team-choice">
          {info.teams.map((t) => (
            <button
              key={t.id}
              className={`team-btn${team === t.id ? ' primary' : ''}`}
              onClick={() => setTeam(t.id)}
              type="button"
              aria-pressed={team === t.id}
            >
              <strong>{t.name}</strong>
              <span className="muted">{t.playerCount} Spieler</span>
            </button>
          ))}
        </div>
      </div>

      {error && <div className="notice error">{error}</div>}

      <button
        className="primary big"
        onClick={join}
        disabled={busy || !info.openJoin || name.trim().length < 2 || team === null}
      >
        Jetzt mitspielen
      </button>
      {!info.openJoin && <p className="muted">Sobald die Moderation den Beitritt freigibt, wird der Knopf aktiv.</p>}
    </section>
  );
}
