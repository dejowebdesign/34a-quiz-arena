import { useEffect, useMemo, useState } from 'react';
import { TEAM_LABELS, type AudienceView as AudienceViewData, type SessionView } from '@quiz/shared';
import type { Route } from '../App';
import { Countdown } from '../components/Countdown';
import { Wheel } from '../components/Wheel';
import { optionLetter } from '../components/Ladder';
import { Realtime, C2S } from '../lib/realtime';

/**
 * Publikumsansicht fuer die Zoom-Uebertragung: grosser Fragetext, Teamstaende,
 * Countdown und Abstimmung beim Publikumsjoker. Die richtige Antwort erscheint
 * erst nach der Freigabe durch die Moderation.
 */
export function AudienceView({ route }: { route: Route }) {
  const [view, setView] = useState<AudienceViewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [code, setCode] = useState(route.query.get('code') ?? '');
  const [ticket, setTicket] = useState<string | null>(sessionStorage.getItem('quiz34a.audienceTicket'));

  useEffect(() => {
    const fromUrl = route.query.get('code');
    if (fromUrl && fromUrl !== code) setCode(fromUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.query.toString()]);

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

  if (!ticket || (error && !view)) {
    return (
      <section className="card" style={{ maxWidth: 560, margin: '0 auto' }}>
        <h1 style={{ marginTop: 0 }}>Publikumsansicht</h1>
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
        {error && <div className="notice error">{error}</div>}
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
    <>
      <section className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="pill gold">{TEAM_LABELS[view.activeTeam]} ist am Zug</span>
          <span className="phase-badge">{view.phase}</span>
        </div>
        <div style={{ marginTop: 12 }}>
          <Countdown countdown={view.countdown} serverNow={view.serverNow} />
        </div>
      </section>

      <div className="grid two">
        {(['A', 'B'] as const).map((team) => (
          <section key={team} className={`card${view.activeTeam === team ? '' : ''}`}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h2 style={{ margin: 0 }}>{view.teams[team].name}</h2>
              {view.teams[team].completed && <span className="pill ok">bestanden</span>}
            </div>
            <p className="muted">
              Stufe {view.teams[team].level} / 15 &middot; Sicherheitsstufe {view.teams[team].floor}
            </p>
            <div className="row">
              {(['ai', 'audience', 'fifty'] as const).map((joker) => (
                <span key={joker} className={view.teams[team].jokers[joker] === 'used' ? 'pill' : 'pill ok'}>
                  {joker === 'ai' ? 'KI' : joker === 'audience' ? 'Publikum' : '50:50'}:{' '}
                  {view.teams[team].jokers[joker] === 'used' ? 'verbraucht' : 'verfuegbar'}
                </span>
              ))}
            </div>
          </section>
        ))}
      </div>

      <section className="card">
        {view.question ? (
          <>
            <span className="pill">{view.question.topic.replaceAll('_', ' ')}</span>{' '}
            <span className="pill">{view.question.difficulty}</span>
            <p className="question-text" style={{ marginTop: 12 }}>
              {view.question.text}
            </p>
            <div className="options">
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
          <p className="muted">Keine aktive Frage.</p>
        )}
      </section>

      {pollActive && view.question && (
        <section className="card">
          <h2>Publikumsjoker - Abstimmung</h2>
          <p className="muted">Stimme fuer eine Antwortoption abgeben. Eine Stimme pro Geraet.</p>
          <div className="options">
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
          <h3 style={{ marginTop: 18 }}>Ergebnis ({view.joker.pollTotal} Stimmen)</h3>
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
        <section className="card">
          <h2>Aufloesung</h2>
          <p>
            Ergebnis:{' '}
            <span className={view.reveal.outcome === 'correct' ? 'pill ok' : 'pill bad'}>
              {view.reveal.outcome === 'correct' ? 'richtig' : view.reveal.outcome === 'wrong' ? 'falsch' : 'keine Antwort'}
            </span>{' '}
            <span className="muted">
              Stufe {view.reveal.levelBefore} &rarr; {view.reveal.levelAfter}
            </span>
          </p>
          {view.reveal.explanation && <p>{view.reveal.explanation}</p>}
          {view.reveal.legalBasis && <p className="muted">Rechtsgrundlage: {view.reveal.legalBasis}</p>}
        </section>
      )}

      <div className="grid two">
        {(['A', 'B'] as const).map((team) => (
          <section key={team} className="card">
            <Wheel
              label={`Gluecksrad ${view.teams[team].name}`}
              players={view.wheels[team].players}
              lastDrawnName={view.wheels[team].lastDrawnName}
              spinning={false}
              onSpin={() => undefined}
            />
          </section>
        ))}
      </div>

      {notice && <div className="notice error">{notice}</div>}
    </>
  );
}
