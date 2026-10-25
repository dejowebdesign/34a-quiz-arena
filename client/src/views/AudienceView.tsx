import { useEffect, useMemo, useState } from 'react';
import { TEAM_LABELS, type AudienceView as AudienceViewData, type SessionView } from '@quiz/shared';
import type { Route } from '../App';
import { Countdown } from '../components/Countdown';
import { Wheel } from '../components/Wheel';
import { optionLetter } from '../components/Ladder';
import { Realtime, C2S } from '../lib/realtime';

/**
 * Publikumsansicht fuer die Zoom-Uebertragung. Feste 16:9-Buehne ohne Scrollen:
 * beide Gewinnleitern, die aktuelle Frage mit allen Optionen, Countdown und
 * Abstimmung beim Publikumsjoker. Das Gluecksrad erscheint nur waehrend der
 * Drehung als Overlay. Die richtige Antwort erscheint erst nach der Freigabe.
 */
export function AudienceView({ route, pass }: { route: Route; pass: string | null }) {
  const [view, setView] = useState<AudienceViewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [code, setCode] = useState(route.query.get('code') ?? '');
  const [ticket, setTicket] = useState<string | null>(sessionStorage.getItem('quiz34a.audienceTicket'));
  const [wheelOpen, setWheelOpen] = useState<'A' | 'B' | null>(null);

  // Einladungslink: Zugangsticket pro Geraet besorgen, ohne Show-Code.
  useEffect(() => {
    if (!pass || ticket) return;
    let cancelled = false;
    fetch(`/api/public/audience/${encodeURIComponent(pass)}`, { method: 'POST' })
      .then(async (response) => {
        if (!response.ok) {
          const payload = (await response.json()) as { message?: string };
          throw new Error(payload.message ?? 'Einladung ungueltig.');
        }
        return (await response.json()) as { token: string };
      })
      .then((payload) => {
        if (cancelled) return;
        sessionStorage.setItem('quiz34a.audienceTicket', payload.token);
        setTicket(payload.token);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [pass, ticket]);

  const join = async (targetCode: string) => {
    setError(null);
    try {
      const response = await fetch(`/api/public/sessions/${targetCode.toUpperCase()}/audience`, { method: 'POST' });
      if (!response.ok) {
        const payload = (await response.json()) as { message?: string };
        throw new Error(payload.message ?? 'Beitritt fehlgeschlagen.');
      }
      const payload = (await response.json()) as { token: string };
      sessionStorage.setItem('quiz34a.audienceTicket', payload.token);
      setTicket(payload.token);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fehler');
    }
  };

  const realtime = useMemo(() => {
    if (!ticket) return null;
    return Realtime.audience(ticket, {
      onView: (incoming: SessionView) => {
        if (incoming.role === 'audience') {
          setView(incoming);
          setError(null);
        }
      },
      onError: (payload) => {
        setNotice(payload.message);
        if (payload.code === 'unauthorized' || payload.code === 'not_found') {
          sessionStorage.removeItem('quiz34a.audienceTicket');
          setTicket(null);
          setError(payload.message);
        }
      },
    });
  }, [ticket]);

  useEffect(() => () => realtime?.close(), [realtime]);

  // Gluecksrad-Overlay nur waehrend der aktiven Drehung oeffnen und danach
  // wieder schliessen. Die Animation ist rein clientseitig; der Serverzustand
  // bleibt unveraendert.
  const lastDrawn = view ? { A: view.wheels.A.lastDrawn, B: view.wheels.B.lastDrawn } : null;
  useEffect(() => {
    if (!view) return;
    if (view.phase === 'idle' && view.wheels[view.activeTeam].lastDrawn) {
      const team = view.activeTeam;
      setWheelOpen(team);
      const timer = window.setTimeout(() => setWheelOpen(null), 4200);
      return () => window.clearTimeout(timer);
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastDrawn?.A, lastDrawn?.B, view?.phase]);

  if (!ticket || (error && !view)) {
    return (
      <section className="card" style={{ maxWidth: 560, margin: '0 auto' }}>
        <h1 style={{ marginTop: 0 }}>Publikumsansicht</h1>
        {error && <div className="notice error">{error}</div>}
        <p className="muted">
          Im Regelfall oeffnest du die Uebertragung ueber den Publikumslink der Moderation. Ohne Link kannst du den
          Show-Code eingeben.
        </p>
        <div className="field">
          <label htmlFor="audience-code">Show-Code</label>
          <input
            id="audience-code"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            maxLength={8}
            placeholder="z. B. K7M2QP"
          />
        </div>
        <button className="primary" onClick={() => join(code)} disabled={code.trim().length < 4}>
          Uebertragung ansehen
        </button>
      </section>
    );
  }

  if (!view) {
    return (
      <section className="card">
        <p className="muted">Uebertragung wird verbunden ...</p>
      </section>
    );
  }

  const pollActive = view.joker.active === 'audience';
  const pollMax = Math.max(1, ...view.joker.poll);

  return (
    <div className="stage">
      {/* Kopfzeile: aktives Team und Phase */}
      <header className="stage-top">
        <div className="row" style={{ justifyContent: 'space-between', width: '100%' }}>
          <span className="pill gold">{TEAM_LABELS[view.activeTeam]} ist am Zug</span>
          <div className="row">
            {!view.gameStarted && <span className="pill warn">Show noch nicht gestartet</span>}
            <Countdown countdown={view.countdown} serverNow={view.serverNow} />
          </div>
        </div>
      </header>

      <div className="stage-body">
        {/* Beide Gewinnleitern gleichzeitig */}
        <aside className="stage-ladders">
          {(['A', 'B'] as const).map((team) => (
            <section key={team} className={`card ladder-panel${view.activeTeam === team ? ' active' : ''}`}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <h2 style={{ margin: 0 }}>{view.teams[team].name}</h2>
                {view.teams[team].completed && <span className="pill ok">bestanden</span>}
              </div>
              <p className="muted" style={{ margin: '4px 0 8px' }}>
                Stufe {view.teams[team].level} / 15
              </p>
              <CompactLadder level={view.teams[team].level} safety={view.teams[team].safetyLevels} />
              <div className="row" style={{ marginTop: 8 }}>
                {(['ai', 'audience', 'fifty'] as const).map((joker) => (
                  <span
                    key={joker}
                    className={view.teams[team].jokers[joker] === 'used' ? 'pill' : 'pill ok'}
                    title={joker === 'ai' ? 'KI-Joker' : joker === 'audience' ? 'Publikumsjoker' : '50:50-Joker'}
                  >
                    {joker === 'ai' ? 'KI' : joker === 'audience' ? 'Publikum' : '50:50'}
                  </span>
                ))}
              </div>
            </section>
          ))}
        </aside>

        {/* Frage und Antworten */}
        <main className="stage-question">
          <section className="card question-stage-card">
            {view.question ? (
              <>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span className="pill">{view.question.topic.replaceAll('_', ' ')}</span>
                  <span className="pill">{view.question.difficulty}</span>
                </div>
                <p className="question-text stage-question-text">{view.question.text}</p>
                <div className="options stage-options">
                  {view.question.options.map((option, index) => {
                    const hidden = view.joker.hiddenOptions.includes(index);
                    const revealedCorrect = view.reveal !== null && view.reveal.correctIndex === index;
                    return (
                      <div
                        key={index}
                        className={`option${hidden ? ' hidden' : ''}${revealedCorrect ? ' correct' : ''}`}
                      >
                        <span className="letter">{optionLetter(index)}</span>
                        <span>{hidden ? 'ausgeblendet (50:50)' : option}</span>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <p className="muted stage-idle">
                {view.gameStarted ? 'Keine aktive Frage.' : 'Die Show wurde noch nicht gestartet.'}
              </p>
            )}
          </section>

          {pollActive && view.question && (
            <section className="card stage-poll">
              <h3 style={{ marginTop: 0 }}>Publikumsjoker - Abstimmung</h3>
              <div className="options stage-options">
                {view.question.options.map((option, index) => (
                  <button
                    key={index}
                    className={`option${view.joker.yourVote === index ? ' selected' : ''}`}
                    onClick={() => realtime?.send(C2S.audienceVote, { optionIndex: index })}
                    disabled={view.joker.yourVote !== null}
                    type="button"
                  >
                    <span className="letter">{optionLetter(index)}</span>
                    <span>{option}</span>
                  </button>
                ))}
              </div>
              <div className="row" style={{ marginTop: 10, justifyContent: 'space-between' }}>
                <strong>Ergebnis ({view.joker.pollTotal} Stimmen)</strong>
                {view.joker.yourVote !== null && <span className="pill ok">Stimme abgegeben</span>}
              </div>
              {view.joker.poll.map((count, index) => (
                <div className="poll-bar" key={index}>
                  <span>{optionLetter(index)}</span>
                  <div className="poll-track">
                    <div className="poll-fill" style={{ width: `${(count / pollMax) * 100}%` }} />
                  </div>
                  <span>{count}</span>
                </div>
              ))}
            </section>
          )}

          {view.reveal && (
            <section className="card stage-reveal">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <h3 style={{ margin: 0 }}>Aufloesung</h3>
                <span className={view.reveal.outcome === 'correct' ? 'pill ok' : 'pill bad'}>
                  {view.reveal.outcome === 'correct'
                    ? 'richtig'
                    : view.reveal.outcome === 'wrong'
                      ? 'falsch'
                      : 'keine Antwort'}
                </span>
              </div>
              <p className="muted" style={{ margin: '6px 0' }}>
                Stufe {view.reveal.levelBefore} &rarr; {view.reveal.levelAfter}
              </p>
              {view.reveal.explanation && <p style={{ margin: 0 }}>{view.reveal.explanation}</p>}
              {view.reveal.legalBasis && (
                <p className="muted" style={{ margin: '6px 0 0' }}>
                  Rechtsgrundlage: {view.reveal.legalBasis}
                </p>
              )}
            </section>
          )}
        </main>
      </div>

      {/* Gluecksrad als Overlay nur waehrend der Drehung */}
      {wheelOpen && (
        <div className="wheel-overlay" role="dialog" aria-label="Gluecksrad">
          <div className="wheel-overlay-card">
            <Wheel
              label={`Gluecksrad ${view.teams[wheelOpen].name}`}
              players={view.wheels[wheelOpen].players}
              lastDrawnName={view.wheels[wheelOpen].lastDrawnName}
              spinning
              onSpin={() => undefined}
            />
          </div>
        </div>
      )}

      {notice && <div className="notice error stage-notice">{notice}</div>}
    </div>
  );
}

/** Kompakte Leiteranzeige 1..15 fuer die Buehne (ohne Scrollen). */
function CompactLadder({ level, safety }: { level: number; safety: number[] }) {
  const rows = Array.from({ length: 15 }, (_, i) => i + 1);
  return (
    <div className="compact-ladder">
      {rows.map((n) => {
        const isSafety = safety.includes(n);
        const reached = n <= level;
        const current = n === level;
        return (
          <div
            key={n}
            className={`compact-step${reached ? ' reached' : ''}${isSafety ? ' safety' : ''}${current ? ' current' : ''}`}
            title={isSafety ? `Sicherheitsstufe ${n}` : `Stufe ${n}`}
          >
            {n}
          </div>
        );
      })}
    </div>
  );
}
