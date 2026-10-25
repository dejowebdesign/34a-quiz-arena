import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { Route } from '../App';

export function HomeView({ route }: { route: Route }) {
  const [approved, setApproved] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .health()
      .then((health) => setApproved(health.approvedQuestions))
      .catch((err: Error) => setError(err.message));
  }, []);

  return (
    <>
      <section className="card">
        <h1 style={{ marginTop: 0 }}>34A Quiz Arena</h1>
        <p className="muted">
          Multiplayer-Quizshow zur Vorbereitung auf die Sachkundepruefung nach § 34a GewO. Zwei Teams, zwei
          Gewinnleitern, eigenes Gluecksrad und drei Joker pro Team.
        </p>
        <div className="notice">
          Dieses Angebot ist ein Uebungswerkzeug. Es ist kein amtlicher Nachweis und ersetzt nicht die Pruefung bei
          der zustaendigen IHK.
        </div>
      </section>

      <div className="grid three">
        <section className="card">
          <h2>Moderation</h2>
          <p className="muted">
            Show anlegen oder fortsetzen: Gewinnleitern, Gluecksrad, Joker, Fragensteuerung, Countdown und
            Antwortaufloesung.
          </p>
          <button className="primary" onClick={() => route.navigate('#/moderator')}>
            Zur Moderation
          </button>
        </section>

        <section className="card">
          <h2>Kandidat</h2>
          <p className="muted">
            Mit Show-Code und Namen beitreten. Die Frage erscheint privat auf dem eigenen Geraet.
          </p>
          <button className="primary" onClick={() => route.navigate('#/join')}>
            Als Kandidat beitreten
          </button>
        </section>

        <section className="card">
          <h2>Publikum</h2>
          <p className="muted">
            Anzeige fuer die Zoom-Uebertragung und Abstimmung beim Publikumsjoker.
          </p>
          <button className="primary" onClick={() => route.navigate('#/audience')}>
            Publikumsansicht
          </button>
        </section>
      </div>

      <section className="card">
        <h2>Systemstatus</h2>
        {error && <div className="notice error">Server nicht erreichbar: {error}</div>}
        {approved !== null && (
          <p>
            <span className="pill ok">{approved} freigegebene Fragen</span>
          </p>
        )}
        <p className="muted">
          Fragenverwaltung nur mit Moderatorenzugang: <a href="#/admin">zum geschuetzten Bereich</a>.
        </p>
      </section>
    </>
  );
}
