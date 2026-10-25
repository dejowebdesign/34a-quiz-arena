import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  C2S,
  JOKER_LABELS,
  TEAM_LABELS,
  type ModeratorView as ModeratorViewData,
  type SessionView,
} from '@quiz/shared';
import type { Route } from '../App';
import { Countdown } from '../components/Countdown';
import { Ladder, optionLetter } from '../components/Ladder';
import { Wheel } from '../components/Wheel';
import { api, ApiError, getModeratorToken, setModeratorToken } from '../lib/api';
import { Realtime } from '../lib/realtime';

/** Moderatorenansicht: vollstaendige Show-Steuerung. */
export function ModeratorView({ route }: { route: Route }) {
  const [token, setToken] = useState<string | null>(getModeratorToken());
  const [user, setUser] = useState('moderator');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);

  const [code, setCode] = useState(route.query.get('code') ?? '');
  const [sessionCode, setSessionCode] = useState<string | null>(route.query.get('code'));
  const [view, setView] = useState<ModeratorViewData | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [players, setPlayers] = useState<{ id: string; name: string; team: 'A' | 'B' }[]>([]);
  const [newPlayer, setNewPlayer] = useState('');
  const [newTeam, setNewTeam] = useState<'A' | 'B'>('A');
  const [approvedQuestions, setApprovedQuestions] = useState<{ id: number; text: string }[]>([]);

  const login = async () => {
    setLoginError(null);
    try {
      const response = await api.login(user, password);
      setModeratorToken(response.token);
      setToken(response.token);
      setPassword('');
    } catch (err) {
      setLoginError(err instanceof ApiError ? err.message : 'Anmeldung fehlgeschlagen.');
    }
  };

  const realtime = useMemo(() => {
    if (!token) return null;
    return Realtime.moderator(token, sessionCode, {
      onView: (incoming: SessionView) => {
        if (incoming.role === 'moderator') {
          setView(incoming);
          setSessionCode(incoming.sessionCode);
        }
      },
      onError: (payload) => setNotice(payload.message),
      onJoined: (payload) => setSessionCode(payload.sessionCode),
    });
  }, [token, sessionCode]);

  useEffect(() => () => realtime?.close(), [realtime]);

  const refreshPlayers = useCallback(async () => {
    if (!sessionCode) return;
    try {
      const response = await fetch(`/api/public/sessions/${sessionCode}`);
      if (!response.ok) return;
      const payload = (await response.json()) as { teams: { id: 'A' | 'B'; players: string[] }[] };
      // Nur Namen bekannt - IDs liefert die Moderatorensicht ueber die Raeder.
      void payload;
    } catch {
      /* nicht kritisch */
    }
  }, [sessionCode]);

  useEffect(() => {
    void refreshPlayers();
  }, [refreshPlayers]);

  const loadApproved = useCallback(async () => {
    if (!token) return;
    try {
      const response = await api.listQuestions({ status: 'approved' });
      setApprovedQuestions(response.questions.map((q) => ({ id: q.id, text: q.text })));
    } catch {
      /* Liste ist optional */
    }
  }, [token]);

  useEffect(() => {
    void loadApproved();
  }, [loadApproved]);

  const createSession = async () => {
    setError(null);
    try {
      const created = await api.createSession(`Show ${new Date().toLocaleDateString('de-DE')}`);
      setSessionCode(created.code);
      setCode(created.code);
      window.history.replaceState(null, '', `#/moderator?code=${created.code}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Show konnte nicht angelegt werden.');
    }
  };

  const registerPlayer = async () => {
    if (!sessionCode) return;
    setError(null);
    try {
      const created = await api.registerPlayer(sessionCode, newPlayer, newTeam);
      setPlayers((current) => [...current, { id: created.playerId, name: newPlayer, team: created.team }]);
      setNewPlayer('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Spieler konnte nicht angelegt werden.');
    }
  };

  const removePlayer = async (playerId: string) => {
    if (!sessionCode) return;
    try {
      await api.removePlayer(sessionCode, playerId);
      setPlayers((current) => current.filter((p) => p.id !== playerId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Spieler konnte nicht entfernt werden.');
    }
  };

  const copyJoinLink = async () => {
    if (!sessionCode) return;
    const candidateUrl = `${window.location.origin}/${view?.invites.candidatePath ?? '#/join'}`;
    try {
      await navigator.clipboard.writeText(candidateUrl);
      setNotice('Teilnehmerlink kopiert.');
    } catch {
      setNotice(candidateUrl);
    }
  };

  const copyAudienceLink = async () => {
    if (!sessionCode) return;
    const audienceUrl = `${window.location.origin}/${view?.invites.audiencePath ?? '#/audience'}`;
    try {
      await navigator.clipboard.writeText(audienceUrl);
      setNotice('Publikumslink kopiert.');
    } catch {
      setNotice(audienceUrl);
    }
  };

  const rotateInvites = async () => {
    if (!sessionCode) return;
    try {
      await api.rotateInvites(sessionCode);
      setNotice('Neue Links erzeugt. Bisherige Links sind jetzt ungueltig.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Links konnten nicht erneuert werden.');
    }
  };

  const startGame = async () => {
    if (!sessionCode) return;
    setError(null);
    try {
      await api.startGame(sessionCode);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Show konnte nicht gestartet werden.');
    }
  };

  const send = (event: string, payload?: unknown) => realtime?.send(event, payload);

  if (!token) {
    return (
      <section className="card" style={{ maxWidth: 460, margin: '0 auto' }}>
        <h1 style={{ marginTop: 0 }}>Moderationsanmeldung</h1>
        <p className="muted">Der Zugang ist geschuetzt. Die Zugangsdaten werden serverseitig geprueft.</p>
        <div className="field">
          <label htmlFor="user">Benutzer</label>
          <input id="user" value={user} onChange={(e) => setUser(e.target.value)} autoComplete="username" />
        </div>
        <div className="field">
          <label htmlFor="password">Passwort</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </div>
        {loginError && <div className="notice error">{loginError}</div>}
        <button className="primary" onClick={login} disabled={password.length === 0}>
          Anmelden
        </button>
      </section>
    );
  }

  if (!sessionCode) {
    return (
      <section className="card" style={{ maxWidth: 620, margin: '0 auto' }}>
        <h1 style={{ marginTop: 0 }}>Show starten</h1>
        <p className="muted">Neue Show anlegen oder bestehende Show per Code fortsetzen.</p>
        {error && <div className="notice error">{error}</div>}
        <div className="row">
          <button className="primary" onClick={createSession}>
            Neue Show anlegen
          </button>
        </div>
        <div className="field" style={{ marginTop: 16 }}>
          <label htmlFor="join-code">Bestehender Show-Code</label>
          <input
            id="join-code"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            maxLength={8}
          />
        </div>
        <button onClick={() => setSessionCode(code.trim().toUpperCase())} disabled={code.trim().length < 4}>
          Show fortsetzen
        </button>
      </section>
    );
  }

  return (
    <>
      <section className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div>
            <span className="pill gold">Show {sessionCode}</span>{' '}
            <span className="pill">{view ? TEAM_LABELS[view.activeTeam] + ' am Zug' : 'verbinde ...'}</span>{' '}
            {view && <span className="phase-badge">{view.phase}</span>}
          </div>
          <div className="row">
            <button className="small" onClick={copyJoinLink}>
              Teilnehmerlink
            </button>
            <button className="small" onClick={copyAudienceLink}>
              Publikumslink
            </button>
            <button
              className="small"
              onClick={() => {
                setModeratorToken(null);
                setToken(null);
                setView(null);
              }}
            >
              Abmelden
            </button>
          </div>
        </div>
        {notice && (
          <div className="notice" style={{ marginTop: 10 }}>
            {notice}
          </div>
        )}
        {error && (
          <div className="notice error" style={{ marginTop: 10 }}>
            {error}
          </div>
        )}
      </section>

      {view && (
        <>
          <section className="card">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h2 style={{ margin: 0 }}>Show starten</h2>
              <span className={view.gameStarted ? 'pill ok' : 'pill warn'}>
                {view.gameStarted ? 'gestartet' : 'noch nicht gestartet'}
              </span>
            </div>
            <p className="muted" style={{ marginTop: 6 }}>
              Verfuegbare freigegebene Fragen: <strong>{view.playableQuestions}</strong> von mindestens{' '}
              <strong>{view.minQuestions}</strong>.
            </p>
            {!view.gameStarted && view.playableQuestions < view.minQuestions && (
              <div className="notice error">
                Die Show kann erst starten, wenn mindestens {view.minQuestions} Fragen freigegeben sind. Es fehlen noch{' '}
                {view.minQuestions - view.playableQuestions}.
              </div>
            )}
            <div className="row" style={{ marginTop: 10 }}>
              <button
                className="primary"
                onClick={startGame}
                disabled={view.gameStarted || view.playableQuestions < view.minQuestions}
              >
                {view.gameStarted ? 'Show laeuft' : 'Show starten'}
              </button>
              <span className="muted">Fragen sind erst nach dem Start freigegeben.</span>
            </div>
          </section>

          <section className="card">
            <h2>Einladungen</h2>
            <p className="muted">
              Diese Links direkt in Zoom oder Chat teilen. Teilnehmer und Publikum brauchen keinen Show-Code.
            </p>
            <InviteRow
              label="Teilnehmerlink"
              path={view.invites.candidatePath}
              onCopy={copyJoinLink}
            />
            <InviteRow
              label="Publikumslink"
              path={view.invites.audiencePath}
              onCopy={copyAudienceLink}
            />
            <div className="row" style={{ marginTop: 10 }}>
              <button className="small danger" onClick={rotateInvites}>
                Links erneuern (alte widerrufen)
              </button>
              <span className="muted">Version {view.invites.version}</span>
            </div>
          </section>

          <section className="card">
            <h2>Zeitsteuerung</h2>
            <Countdown countdown={view.countdown} serverNow={view.serverNow} />
            <div className="row" style={{ marginTop: 12 }}>
              <button
                className="primary"
                onClick={() => send(C2S.startCountdown)}
                disabled={view.phase !== 'question' && view.phase !== 'joker'}
              >
                Letzte 10 Sekunden starten
              </button>
              <button onClick={() => send(C2S.pauseCountdown)} disabled={view.countdown.state !== 'running'}>
                Pausieren (Joker)
              </button>
              <button onClick={() => send(C2S.resumeCountdown)} disabled={view.countdown.state !== 'paused'}>
                Fortsetzen
              </button>
            </div>
          </section>

          <div className="grid two">
            {(['A', 'B'] as const).map((team) => (
              <section key={team} className="card">
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <h2 style={{ margin: 0 }}>{view.teams[team].name}</h2>
                  {view.teams[team].completed && <span className="pill ok">Challenge bestanden</span>}
                </div>
                <Ladder team={view.teams[team]} maxLevel={15} />
                <div className="row" style={{ marginTop: 10 }}>
                  {(['ai', 'audience', 'fifty'] as const).map((joker) => (
                    <button
                      key={joker}
                      className="small"
                      disabled={view.teams[team].jokers[joker] === 'used' || view.phase === 'idle'}
                      onClick={() => send(C2S.activateJoker, { type: joker, team })}
                    >
                      {JOKER_LABELS[joker]}: {view.teams[team].jokers[joker] === 'used' ? 'verbraucht' : 'einsetzen'}
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>

          <div className="grid two">
            {(['A', 'B'] as const).map((team) => (
              <section key={team} className="card">
                <Wheel
                  label={`Gluecksrad ${view.teams[team].name}`}
                  players={view.wheels[team].players}
                  lastDrawnName={view.wheels[team].lastDrawnName}
                  spinning={false}
                  onSpin={() => send(C2S.spinWheel, { team })}
                />
                <p className="muted">
                  Durchgaenge abgeschlossen: {view.wheels[team].roundsCompleted} &middot; unabhaengig vom Leiterfortschritt
                </p>
              </section>
            ))}
          </div>

          <section className="card">
            <h2>Frage</h2>
            {view.currentQuestion ? (
              <>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span className="pill">{view.currentQuestion.topic.replaceAll('_', ' ')}</span>
                  <span className="pill">{view.currentQuestion.difficulty}</span>
                  <span className="pill">Frage #{view.currentQuestion.id}</span>
                </div>
                <p className="question-text" style={{ marginTop: 12 }}>
                  {view.currentQuestion.text}
                </p>
                <div className="options">
                  {view.currentQuestion.options.map((option, index) => {
                    const hidden = view.joker.hiddenOptions.includes(index);
                    const isCorrect = view.currentQuestion!.correctIndex === index;
                    return (
                      <div key={index} className={`option${hidden ? ' hidden' : ''}${isCorrect ? ' correct' : ''}`}>
                        <span className="letter">{optionLetter(index)}</span>
                        <span>{option}</span>
                        {isCorrect && <span className="pill ok">richtig</span>}
                      </div>
                    );
                  })}
                </div>
                <div className="row" style={{ marginTop: 12 }}>
                  <span className="pill">
                    Antwort: {view.answers[view.activeTeam]?.playerName ?? 'noch keine'}
                    {view.answers[view.activeTeam]
                      ? ` (${optionLetter(view.answers[view.activeTeam]!.optionIndex)})`
                      : ''}
                  </span>
                </div>
                {view.currentQuestion.explanation && (
                  <p className="muted" style={{ marginTop: 10 }}>
                    Erklaerung: {view.currentQuestion.explanation}
                  </p>
                )}
                {view.currentQuestion.legalBasis && (
                  <p className="muted">
                    Rechtsgrundlage: {view.currentQuestion.legalBasis}{' '}
                    <span className={view.currentQuestion.legalStatus === 'verified' ? 'pill ok' : 'pill warn'}>
                      {view.currentQuestion.legalStatus === 'verified' ? 'Rechtsstand geprueft' : 'Rechtsstand nicht geprueft'}
                    </span>
                  </p>
                )}
              </>
            ) : (
              <p className="muted">Keine aktive Frage. Frage starten oder Gluecksrad drehen.</p>
            )}

            <div className="row" style={{ marginTop: 14 }}>
              <button
                className="primary"
                onClick={() => send(C2S.startQuestion, { random: true })}
                disabled={view.phase === 'question' || view.phase === 'joker'}
              >
                Zufallsfrage starten
              </button>
              <button onClick={() => send(C2S.reveal)} disabled={view.phase !== 'question' && view.phase !== 'joker'}>
                Antwort freigeben
              </button>
              <button onClick={() => send(C2S.closeJoker)} disabled={view.joker.active === null}>
                Joker beenden
              </button>
              <button onClick={() => send(C2S.clearQuestion)} disabled={view.phase === 'idle'}>
                Frage abbrechen
              </button>
              <button onClick={() => send(C2S.nextTeam)} disabled={view.phase === 'question' || view.phase === 'joker'}>
                Team wechseln
              </button>
              <button
                className="danger"
                onClick={() => {
                  if (confirm('Spielstand wirklich zuruecksetzen? Zertifikate bleiben erhalten.')) send(C2S.resetGame);
                }}
              >
                Spiel zuruecksetzen
              </button>
            </div>

            {approvedQuestions.length > 0 && (
              <div className="field" style={{ marginTop: 14 }}>
                <label htmlFor="question-picker">Freigegebene Frage gezielt starten</label>
                <select
                  id="question-picker"
                  defaultValue=""
                  onChange={(e) => {
                    const id = Number(e.target.value);
                    if (id) send(C2S.startQuestion, { questionId: id });
                    e.target.value = '';
                  }}
                  disabled={view.phase === 'question' || view.phase === 'joker'}
                >
                  <option value="">-- Frage waehlen --</option>
                  {approvedQuestions.map((q) => (
                    <option key={q.id} value={q.id}>
                      #{q.id} {q.text.slice(0, 70)}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </section>

          {view.joker.active && (
            <section className="card">
              <h2>{JOKER_LABELS[view.joker.active]} aktiv</h2>
              {view.joker.aiHint && <p className="notice">{view.joker.aiHint}</p>}
              {view.joker.active === 'audience' && (
                <>
                  <p className="muted">Abstimmung laeuft ({view.joker.pollTotal} Stimmen).</p>
                  {view.joker.poll.map((count, index) => (
                    <div className="poll-bar" key={index}>
                      <span>{optionLetter(index)}</span>
                      <div className="poll-track">
                        <div
                          className="poll-fill"
                          style={{ width: `${(count / Math.max(1, ...view.joker.poll)) * 100}%` }}
                        />
                      </div>
                      <span>{count}</span>
                    </div>
                  ))}
                </>
              )}
              {view.joker.active === 'fifty' && (
                <p className="muted">
                  Ausgeblendet: {view.joker.hiddenOptions.map((i) => optionLetter(i)).join(', ')}
                </p>
              )}
            </section>
          )}

          <section className="card">
            <h2>Kandidaten verwalten</h2>
            <div className="row">
              <div style={{ flex: '1 1 220px' }}>
                <label htmlFor="player-name">Name</label>
                <input id="player-name" value={newPlayer} onChange={(e) => setNewPlayer(e.target.value)} maxLength={40} />
              </div>
              <div>
                <label>Team</label>
                <div className="row">
                  {(['A', 'B'] as const).map((team) => (
                    <button key={team} className={newTeam === team ? 'primary' : ''} onClick={() => setNewTeam(team)}>
                      {view.teams[team].name}
                    </button>
                  ))}
                </div>
              </div>
              <button className="primary" onClick={registerPlayer} disabled={newPlayer.trim().length < 2}>
                Hinzufuegen
              </button>
            </div>

            <div className="row" style={{ marginTop: 12 }}>
              <button
                className={view.openJoin ? 'primary' : ''}
                onClick={() => send(C2S.setOpenJoin, { open: !view.openJoin })}
              >
                Code-Beitritt: {view.openJoin ? 'freigegeben' : 'gesperrt'}
              </button>
              <span className="muted">
                Gilt nur fuer den Ersatzweg mit Show-Code. Einladungslinks funktionieren unabhaengig davon.
              </span>
            </div>

            <div className="grid two" style={{ marginTop: 12 }}>
              {(['A', 'B'] as const).map((team) => (
                <div key={team}>
                  <h3>{view.teams[team].name}</h3>
                  <ul className="player-list">
                    {view.wheels[team].players.map((player) => (
                      <li key={player.id}>
                        <span>{player.name}</span>
                        <button className="small danger" onClick={() => removePlayer(player.id)}>
                          entfernen
                        </button>
                      </li>
                    ))}
                    {view.wheels[team].players.length === 0 && <li className="muted">noch keine Spieler</li>}
                  </ul>
                  <div className="field" style={{ marginTop: 8 }}>
                    <label>Sicherheitsstufen (Komma-getrennt)</label>
                    <input
                      defaultValue={view.teams[team].safetyLevels.join(', ')}
                      onBlur={(e) =>
                        send(C2S.setSafetyLevels, {
                          team,
                          levels: e.target.value
                            .split(',')
                            .map((part) => Number(part.trim()))
                            .filter((n) => Number.isInteger(n)),
                        })
                      }
                    />
                  </div>
                </div>
              ))}
            </div>
            {players.length > 0 && <p className="muted">Zuletzt angelegt: {players.map((p) => p.name).join(', ')}</p>}
          </section>

          <section className="card">
            <h2>Protokoll</h2>
            <ul className="player-list">
              {[...view.log].reverse().map((entry, index) => (
                <li key={index}>
                  <span className="muted">{new Date(entry.at).toLocaleTimeString('de-DE')}</span>
                  <span>{entry.text}</span>
                </li>
              ))}
            </ul>
          </section>

          {view.certificates.length > 0 && (
            <section className="card">
              <h2>Ausgestellte Zertifikate</h2>
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Team</th>
                    <th>Stufe</th>
                    <th>Datum</th>
                    <th>Link</th>
                  </tr>
                </thead>
                <tbody>
                  {view.certificates.map((certificate) => (
                    <tr key={certificate.id}>
                      <td>{certificate.playerName}</td>
                      <td>Team {certificate.team}</td>
                      <td>{certificate.level}</td>
                      <td>{new Date(certificate.issuedAt).toLocaleString('de-DE')}</td>
                      <td>
                        <a href={`#/certificate/${certificate.id}`}>ansehen</a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </>
      )}
    </>
  );
}

/**
 * Zeile mit Einladungslink: vollstaendige URL, Kopierknopf und optionaler
 * QR-Code. Der QR-Code wird lokal erzeugt (Abhaengigkeit `qrcode`), damit der
 * signierte Link das Geraet nicht verlaesst.
 */
function InviteRow({ label, path, onCopy }: { label: string; path: string; onCopy: () => void }) {
  const [showQr, setShowQr] = useState(false);
  const [qrSrc, setQrSrc] = useState<string | null>(null);
  const url = path ? `${window.location.origin}/${path}` : '';

  useEffect(() => {
    if (!showQr || !url) return;
    let cancelled = false;
    import('qrcode')
      .then((QR) => QR.toDataURL(url, { width: 180, margin: 1 }))
      .then((dataUrl) => {
        if (!cancelled) setQrSrc(dataUrl);
      })
      .catch(() => {
        if (!cancelled) setQrSrc(null);
      });
    return () => {
      cancelled = true;
    };
  }, [showQr, url]);

  return (
    <div className="invite-row">
      <label>{label}</label>
      <div className="row">
        <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
        <button className="small primary" onClick={onCopy} type="button">
          Kopieren
        </button>
        <button className="small" onClick={() => setShowQr((v) => !v)} type="button" disabled={!url}>
          {showQr ? 'QR ausblenden' : 'QR-Code'}
        </button>
      </div>
      {showQr && qrSrc && (
        <img className="qr" src={qrSrc} alt={`QR-Code fuer ${label}`} width={180} height={180} />
      )}
    </div>
  );
}
