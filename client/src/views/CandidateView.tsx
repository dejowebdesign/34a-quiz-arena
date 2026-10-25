import { useEffect, useMemo, useState } from 'react';
import { TEAM_LABELS, type CandidateView as CandidateViewData, type SessionView } from '@quiz/shared';
import type { Route } from '../App';
import { Countdown } from '../components/Countdown';
import { Ladder, OptionLetter } from '../components/Ladder';
import { Realtime, C2S } from '../lib/realtime';
import { CertificateCard } from './CertificatePage';

/**
 * Mobile Teilnehmeransicht. Zeigt die aktuelle Frage gross und antippbar,
 * solange das eigene Team an der Reihe ist. Ist das Team nicht an der Reihe,
 * erscheint eine Warteansicht ohne Frage. Die richtige Antwort kommt erst nach
 * der Freigabe durch die Moderation an.
 */
export function CandidateView({ route }: { route: Route }) {
  const [view, setView] = useState<CandidateViewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<number | null>(null);
  const [connection, setConnection] = useState<'connecting' | 'online' | 'error'>('connecting');

  const ticket = sessionStorage.getItem('quiz34a.candidateTicket');

  const realtime = useMemo(() => {
    if (!ticket) return null;
    return Realtime.candidate(ticket, {
      onView: (incoming: SessionView) => {
        if (incoming.role === 'candidate') {
          setView(incoming);
          setPending(null);
          setConnection('online');
        }
      },
      onError: (payload) => {
        setNotice(payload.message);
        setPending(null);
        if (payload.code === 'unauthorized' || payload.code === 'unknown_player') {
          setConnection('error');
          setError(payload.message);
        }
      },
    });
  }, [ticket]);

  useEffect(() => () => realtime?.close(), [realtime]);

  if (!ticket) {
    return (
      <section className="card">
        <h1 style={{ marginTop: 0 }}>Kein Zugang</h1>
        <p className="muted">Bitte zuerst ueber den Einladungslink der Moderation beitreten.</p>
        <button className="primary" onClick={() => route.navigate('#/join')}>
          Zum Beitritt
        </button>
      </section>
    );
  }

  if (error) {
    return (
      <section className="card">
        <h1 style={{ marginTop: 0 }}>Verbindung nicht moeglich</h1>
        <div className="notice error">{error}</div>
        <button
          onClick={() => {
            sessionStorage.removeItem('quiz34a.candidateTicket');
            route.navigate('#/join');
          }}
        >
          Neu beitreten
        </button>
      </section>
    );
  }

  if (!view) {
    return (
      <section className="card">
        <p className="muted">Verbindung wird aufgebaut ...</p>
      </section>
    );
  }

  const { question, hiddenOptions, reveal, countdown } = view;
  const answerable =
    view.isDrawn && view.isActive && view.yourAnswer === null && reveal === null && countdown.state !== 'expired';
  const canSeeQuestion = view.gameStarted && view.isActive && question !== null;

  const submit = (index: number) => {
    if (!answerable) return;
    setPending(index);
    realtime?.send(C2S.answer, { optionIndex: index });
  };

  return (
    <div className="candidate-mobile">
      <header className="candidate-head">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div className="row" style={{ gap: 8 }}>
            <span className="pill gold">{view.playerName}</span>
            <span className="pill">{TEAM_LABELS[view.team]}</span>
          </div>
          <span className={connection === 'online' ? 'pill ok' : 'pill warn'}>
            {connection === 'online' ? 'verbunden' : 'verbindet'}
          </span>
        </div>
      </header>

      {/* --- Warten: eigenes Team nicht am Zug --- */}
      {!canSeeQuestion && !reveal && (
        <section className="card wait-card">
          {!view.gameStarted ? (
            <>
              <h2>Bitte warten</h2>
              <p className="muted">Die Show wurde noch nicht gestartet. Gleich geht es los.</p>
            </>
          ) : (
            <>
              <h2>Bitte warten</h2>
              <p className="wait-text">
                Das andere Team ist gerade an der Reihe. Die Frage erscheint hier automatisch, sobald dein Team
                dran ist.
              </p>
            </>
          )}
          <div style={{ marginTop: 8 }}>
            <Countdown countdown={countdown} serverNow={view.serverNow} />
          </div>
        </section>
      )}

      {/* --- Eigenes Team ist am Zug, aber noch kein Kandidat gezogen --- */}
      {canSeeQuestion && !view.isDrawn && (
        <section className="card wait-card">
          <h2>Dein Team ist am Zug</h2>
          <p className="wait-text">Das Gluecksrad waehlt gerade den Kandidaten. Bitte warten.</p>
          <div style={{ marginTop: 8 }}>
            <Countdown countdown={countdown} serverNow={view.serverNow} />
          </div>
        </section>
      )}

      {/* --- Aktive Frage --- */}
      {canSeeQuestion && view.isDrawn && (
        <>
          <section className="card question-card">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="pill">{question!.topic.replaceAll('_', ' ')}</span>
              <span className="pill">{question!.difficulty}</span>
            </div>
            <p className="question-text mobile-question">{question!.text}</p>
            <Countdown countdown={countdown} serverNow={view.serverNow} />
          </section>

          <div className="options mobile-options">
            {question!.options.map((option, index) => {
              const hidden = hiddenOptions.includes(index);
              const chosen = view.yourAnswer === index;
              const classes = ['option', chosen ? 'selected' : '', hidden ? 'hidden' : ''].filter(Boolean).join(' ');
              return (
                <button
                  key={index}
                  className={classes}
                  onClick={() => submit(index)}
                  disabled={!answerable || hidden}
                  type="button"
                >
                  <OptionLetter index={index} />
                  <span>{hidden ? 'ausgeblendet (50:50)' : option}</span>
                </button>
              );
            })}
          </div>

          {pending !== null && view.yourAnswer === null && (
            <p className="muted answer-status">Antwort wird verbindlich uebermittelt ...</p>
          )}
          {view.yourAnswer !== null && reveal === null && (
            <div className="notice answer-status">
              Antwort abgegeben ({['A', 'B', 'C', 'D'][view.yourAnswer]}). Warte auf die Freigabe durch die Moderation.
            </div>
          )}
          {countdown.state === 'expired' && view.yourAnswer === null && (
            <div className="notice error answer-status">Die Antwortzeit ist abgelaufen.</div>
          )}
        </>
      )}

      {notice && !reveal && <div className="notice error">{notice}</div>}

      {/* --- Aufloesung --- */}
      {reveal && (
        <section className="card">
          <h2>Aufloesung</h2>
          <p>
            Ergebnis:{' '}
            <span className={reveal.outcome === 'correct' ? 'pill ok' : 'pill bad'}>
              {reveal.outcome === 'correct' ? 'richtig' : reveal.outcome === 'wrong' ? 'falsch' : 'keine Antwort'}
            </span>
          </p>
          <p className="muted">
            Stufe {reveal.levelBefore} &rarr; Stufe {reveal.levelAfter}
          </p>
          {reveal.explanation && <p>{reveal.explanation}</p>}
          {reveal.legalBasis && (
            <p className="muted">
              Rechtsgrundlage: {reveal.legalBasis}{' '}
              <span className={reveal.legalStatus === 'verified' ? 'pill ok' : 'pill warn'}>
                {reveal.legalStatus === 'verified' ? 'Rechtsstand geprueft' : 'Rechtsstand nicht geprueft'}
              </span>
            </p>
          )}
          {reveal.sourceNote && <p className="muted">Quelle: {reveal.sourceNote}</p>}
        </section>
      )}

      {view.certificate && <CertificateCard certificate={view.certificate} />}

      <details className="card ladder-details">
        <summary>
          {TEAM_LABELS[view.team]} - Gewinnleiter (Stufe {view.teamState.level}/15)
        </summary>
        <Ladder team={view.teamState} maxLevel={15} />
      </details>
    </div>
  );
}
