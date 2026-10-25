import { useEffect, useState } from 'react';
import type { CertificateView } from '@quiz/shared';

const DISCLAIMER =
  '34A Quiz Arena - Leistungszertifikat. Kein amtlicher Nachweis der bestandenen Sachkundepruefung nach § 34a GewO. ' +
  'Dieses Dokument bestaetigt ausschliesslich die Teilnahme an einer Quizshow zu Uebungszwecken.';

/** Persoenliche Abschlussseite. Wird nach Erreichen von Stufe 15 angezeigt. */
export function CertificateCard({ certificate }: { certificate: CertificateView }) {
  const url = `${window.location.origin}/#/certificate/${certificate.id}`;
  const date = new Date(certificate.issuedAt).toLocaleDateString('de-DE', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });

  return (
    <div className="certificate">
      <div style={{ textAlign: 'center' }}>
        <h1>34A Quiz Arena</h1>
        <p style={{ margin: 0, letterSpacing: '2px', textTransform: 'uppercase', fontSize: '0.8rem' }}>
          Leistungszertifikat
        </p>
      </div>

      <div className="meta">
        <div>
          <strong>Name</strong>
          <br />
          {certificate.playerName}
        </div>
        <div>
          <strong>Team</strong>
          <br />
          Team {certificate.team}
        </div>
        <div>
          <strong>Erreichte Stufe</strong>
          <br />
          {certificate.level} von 15
        </div>
        <div>
          <strong>Datum</strong>
          <br />
          {date}
        </div>
      </div>

      <p style={{ fontSize: '0.95rem' }}>
        In der Quizshow „34A Quiz Arena“ wurde die hoechste Stufe der Gewinnleiter erreicht.
      </p>

      <p style={{ fontSize: '0.8rem', textAlign: 'center', wordBreak: 'break-all' }}>
        Abrufbar unter: <a href={url}>{url}</a>
      </p>

      <div className="disclaimer">{certificate.disclaimer || DISCLAIMER}</div>
    </div>
  );
}

interface PublicCertificate {
  id: string;
  playerName: string;
  team: 'A' | 'B';
  level: number;
  issuedAt: string;
}

/** Aufrufbare Zertifikatsseite (auch per QR-Code). */
export function CertificatePage({ id }: { id: string; route?: unknown }) {
  const [certificate, setCertificate] = useState<PublicCertificate | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/public/certificates/${id}`)
      .then(async (response) => {
        if (!response.ok) throw new Error('Zertifikat nicht gefunden.');
        return (await response.json()) as { certificate: PublicCertificate };
      })
      .then((payload) => setCertificate(payload.certificate))
      .catch((err: Error) => setError(err.message));
  }, [id]);

  if (error) {
    return (
      <section className="card">
        <div className="notice error">{error}</div>
      </section>
    );
  }
  if (!certificate) {
    return (
      <section className="card">
        <p className="muted">Zertifikat wird geladen ...</p>
      </section>
    );
  }
  return (
    <CertificateCard
      certificate={{ ...certificate, disclaimer: DISCLAIMER }}
    />
  );
}
