import { useEffect, useMemo, useState } from 'react';
import { TEAM_LABELS, type CandidateView as CandidateViewData, type SessionView } from '@quiz/shared';
import type { Route } from '../App';
import { Countdown } from '../components/Countdown';
import { Ladder, OptionLetter } from '../components/Ladder';
import { Realtime, C2S } from '../lib/realtime';
import { CertificateCard } from './CertificatePage';

/**
 * Kandidatenansicht. Enthaelt ausschliesslich die oeffentliche Frage. Die
 * richtige Antwort kommt erst nach der Freigabe durch die Moderation an.
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
        <p className="muted">Bitte zuerst mit dem Show-Code beitreten.</p>
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
  const answerable = view.isDrawn && view.isActive && view.yourAnswer === null && reveal === null && countdown.state !== 'expired';

  const submit = (index: number) => {
    if (!answerable) return;
    setPending(index);
    realtime?.send(C2S.answer, { optionIndex: index });
  };

  return (
    <>
      <section className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div>
            <span className="pill gold">{view.playerName}</span>{' '}
            <span className="pill">{TEAM_LABELS[view.team]}</span>
          </div>
          <span className={connection === 'online' ? 'pill ok' : 'pill warn'}>
            {connection === 'online' ? 'verbunden' : 'verbindet'}
          </span>
        </div>

        {view.certificate ? (
          <div className="notice" style={{ marginTop: 12 }}>
            Deine Challenge ist bestanden. Das Zertifikat findest du unten auf dieser Seite.
          </div>
        ) : (
          <p className="muted" style={{ marginTop: 10 }}>
            {view.isActive
              ? view.isDrawn
                ? 'Du bist am Zug. Gib deine Antwort verbindlich ab.'
                : 'Dein Team ist am Zug - das Gluecksrad waehlt den Kandidaten.'
              : 'Dein Team ist nicht am Zug. Bitte warten.'}
          </p>
        )}

        <div style={{ marginTop: 12 }}>
          <Countdown countdown={countdown} serverNow={view.serverNow} />
        </div>
      </section>

      {notice && !reveal && (
        <div className="notice error" style={{ marginBottom: 16 }}>
          {notice}
        </div>
      )}

      <section className="card">
        {question ? (
          <>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="pill">{question.topic.replaceAll('_', ' ')}</span>
              <span className="pill">{question.difficulty}</span>
            </div>
            <p className="question-text" style={{ marginTop: 12 }}>
              {question.text}
            </p>
            <div className="options">
              {question.options.map((option, index) => {
                const hidden = hiddenOptions.includes(index);
                const chosen = view.yourAnswer === index;
                const revealedCorrect = reveal !== null && reveal.correctIndex === index;
                const revealedWrong = reveal !== null && reveal.chosenIndex === index && reveal.correctIndex !== index;
                const classes = [
                  'option',
                  chosen ? 'selected' : '',
                  revealedCorrect ? 'correct' : '',
                  revealedWrong ? 'wrong' : '',
                  hidden ? 'hidden' : '',
                ]
                  .filter(Boolean)
                  .join(' ');
                return (
                  <button key={index} className={classes} onClick={() => submit(index)} disabled={!answerable} type="button">
                    <OptionLetter index={index} />
                    <span>{hidden ? 'ausgeblendet (50:50)' : option}</span>
                  </button>
                );
              })}
            </div>

            {pending !== null && view.yourAnswer === null && (
              <p className="muted" style={{ marginTop: 10 }}>
                Antwort wird verbindlich uebermittelt ...
              </p>
            )}
            {view.yourAnswer !== null && reveal === null && (
              <p className="notice" style={{ marginTop: 12 }}>
                Antwort abgegeben. Warte auf die Freigabe durch die Moderation.
              </p>
            )}
          </>
        ) : (
          <p className="muted">
            Aktuell wird keine Frage angezeigt. Sobald dein Team am Zug ist, erscheint die Frage hier privat.
          </p>
        )}
      </section>

      {reveal && (
        <section className="card">
          <h2>Aufloesung</h2>
          <p>
            Ergebnis:{' '}
            <span className={reveal.outcome === 'correct' ? 'pill ok' : 'pill bad'}>
              {reveal.outcome === 'correct'
                ? 'richtig'
                : reveal.outcome === 'wrong'
                  ? 'falsch'
                  : 'keine Antwort'}
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

      <section className="card">
        <h2>{TEAM_LABELS[view.team]} - Gewinnleiter</h2>
        <Ladder team={view.teamState} maxLevel={15} />
      </section>

      {view.certificate && <CertificateCard certificate={view.certificate} />}
    </>
  );
}
