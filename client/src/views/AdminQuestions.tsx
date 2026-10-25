import { useCallback, useEffect, useState } from 'react';
import type { Route } from '../App';
import { api, ApiError, getModeratorToken, setModeratorToken, type QuestionDto, type QuestionPayload } from '../lib/api';

const EMPTY: QuestionPayload = {
  topic: 'oeffentliches_recht_gewerberecht',
  difficulty: 'leicht',
  text: '',
  options: ['', '', '', ''],
  correctIndex: 0,
  explanation: '',
  legalBasis: '',
  legalStatus: 'unverified',
  sourceNote: '',
  status: 'draft',
};

/**
 * Geschuetzte Fragenverwaltung. Rechtsfragen muessen als geprueft oder
 * ungeprueft gekennzeichnet werden. Es werden keine Quellen erfunden.
 */
export function AdminQuestions({ route }: { route: Route }) {
  const [token, setToken] = useState<string | null>(getModeratorToken());
  const [user, setUser] = useState('moderator');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);

  const [meta, setMeta] = useState<Awaited<ReturnType<typeof api.meta>> | null>(null);
  const [questions, setQuestions] = useState<QuestionDto[]>([]);
  const [filterStatus, setFilterStatus] = useState('');
  const [filterTopic, setFilterTopic] = useState('');
  const [draft, setDraft] = useState<QuestionPayload>(EMPTY);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importText, setImportText] = useState('');

  const loadMeta = useCallback(async () => {
    try {
      setMeta(await api.meta());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Metadaten nicht ladbar.');
    }
  }, []);

  const loadQuestions = useCallback(async () => {
    if (!token) return;
    try {
      const response = await api.listQuestions({ status: filterStatus || undefined, topic: filterTopic || undefined });
      setQuestions(response.questions);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setModeratorToken(null);
        setToken(null);
        return;
      }
      setError(err instanceof Error ? err.message : 'Fragen nicht ladbar.');
    }
  }, [token, filterStatus, filterTopic]);

  useEffect(() => {
    void loadMeta();
  }, [loadMeta]);

  useEffect(() => {
    void loadQuestions();
  }, [loadQuestions]);

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

  const save = async () => {
    setError(null);
    setMessage(null);
    try {
      if (editingId === null) {
        await api.createQuestion(draft);
        setMessage('Frage angelegt.');
      } else {
        await api.updateQuestion(editingId, draft);
        setMessage('Frage gespeichert.');
      }
      setDraft(EMPTY);
      setEditingId(null);
      await loadQuestions();
    } catch (err) {
      if (err instanceof ApiError) {
        setError([err.message, ...err.details].join(' | '));
      } else {
        setError('Speichern fehlgeschlagen.');
      }
    }
  };

  const edit = (question: QuestionDto) => {
    setEditingId(question.id);
    setDraft({
      topic: question.topic,
      difficulty: question.difficulty,
      text: question.text,
      options: [...question.options],
      correctIndex: question.correctIndex,
      explanation: question.explanation,
      legalBasis: question.legalBasis ?? '',
      legalStatus: question.legalStatus,
      sourceNote: question.sourceNote ?? '',
      status: question.status,
    });
  };

  const importJson = async () => {
    setError(null);
    setMessage(null);
    try {
      const parsed = JSON.parse(importText) as unknown;
      const items = Array.isArray(parsed) ? parsed : (parsed as { questions?: unknown[] }).questions;
      if (!Array.isArray(items)) throw new Error('Es wird ein JSON-Array oder {"questions": [...]} erwartet.');
      const result = await api.importQuestions(items);
      setMessage(`Import: ${result.imported} angelegt, ${result.failed} fehlerhaft.`);
      if (result.failed > 0) setError(result.errors.map((e) => `#${e.index}: ${e.message}`).join(' | '));
      setImportText('');
      await loadQuestions();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import fehlgeschlagen.');
    }
  };

  if (!token) {
    return (
      <section className="card" style={{ maxWidth: 460, margin: '0 auto' }}>
        <h1 style={{ marginTop: 0 }}>Fragenverwaltung</h1>
        <p className="muted">Geschuetzter Bereich. Bitte mit Moderatorenzugang anmelden.</p>
        <div className="field">
          <label htmlFor="admin-user">Benutzer</label>
          <input id="admin-user" value={user} onChange={(e) => setUser(e.target.value)} autoComplete="username" />
        </div>
        <div className="field">
          <label htmlFor="admin-password">Passwort</label>
          <input
            id="admin-password"
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

  const topics = meta?.topics ?? [];
  const difficulties = meta?.difficulties ?? [];
  const statuses = meta?.questionStatuses ?? [];
  const legalStatuses = meta?.legalStatuses ?? [];

  return (
    <>
      <section className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h1 style={{ margin: 0 }}>Fragenverwaltung</h1>
          <button
            onClick={() => {
              setModeratorToken(null);
              setToken(null);
            }}
          >
            Abmelden
          </button>
        </div>
        <div className="notice" style={{ marginTop: 10 }}>
          Rechtsangaben muessen als geprueft oder ungeprueft gekennzeichnet werden. Bitte keine erfundenen Quellen und
          keine offiziellen IHK-Fragen hinterlegen.
        </div>
        {message && (
          <div className="notice" style={{ marginTop: 10 }}>
            {message}
          </div>
        )}
        {error && (
          <div className="notice error" style={{ marginTop: 10 }}>
            {error}
          </div>
        )}
      </section>

      <section className="card">
        <h2>{editingId === null ? 'Neue Frage' : `Frage #${editingId} bearbeiten`}</h2>
        <div className="grid two">
          <div className="field">
            <label>Themengebiet</label>
            <select value={draft.topic} onChange={(e) => setDraft({ ...draft, topic: e.target.value })}>
              {topics.map((topic) => (
                <option key={topic.id} value={topic.id}>
                  {topic.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Schwierigkeit</label>
            <select value={draft.difficulty} onChange={(e) => setDraft({ ...draft, difficulty: e.target.value })}>
              {difficulties.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="field">
          <label>Fragetext</label>
          <textarea rows={3} value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} />
        </div>

        <label>Antwortoptionen (die richtige wird markiert)</label>
        {draft.options.map((option, index) => (
          <div className="row" key={index} style={{ marginBottom: 8 }}>
            <input
              type="radio"
              name="correct"
              checked={draft.correctIndex === index}
              onChange={() => setDraft({ ...draft, correctIndex: index })}
              style={{ width: 'auto' }}
            />
            <input
              value={option}
              onChange={(e) => {
                const options = [...draft.options];
                options[index] = e.target.value;
                setDraft({ ...draft, options });
              }}
            />
          </div>
        ))}

        <div className="field">
          <label>Erklaerung der Loesung</label>
          <textarea
            rows={2}
            value={draft.explanation}
            onChange={(e) => setDraft({ ...draft, explanation: e.target.value })}
          />
        </div>

        <div className="grid two">
          <div className="field">
            <label>Rechtsgrundlage / Paragraph</label>
            <input
              value={draft.legalBasis ?? ''}
              onChange={(e) => setDraft({ ...draft, legalBasis: e.target.value })}
              placeholder="z. B. § 34a GewO"
            />
          </div>
          <div className="field">
            <label>Rechtsstatus</label>
            <select value={draft.legalStatus} onChange={(e) => setDraft({ ...draft, legalStatus: e.target.value })}>
              {legalStatuses.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid two">
          <div className="field">
            <label>Quelle / Pruefstatus</label>
            <input
              value={draft.sourceNote ?? ''}
              onChange={(e) => setDraft({ ...draft, sourceNote: e.target.value })}
              placeholder="z. B. Gesetzestext, Stand 2024"
            />
          </div>
          <div className="field">
            <label>Redaktioneller Status</label>
            <select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })}>
              {statuses.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="row">
          <button className="primary" onClick={save} disabled={draft.text.trim().length < 5}>
            {editingId === null ? 'Anlegen' : 'Speichern'}
          </button>
          {editingId !== null && (
            <button
              onClick={() => {
                setEditingId(null);
                setDraft(EMPTY);
              }}
            >
              Abbrechen
            </button>
          )}
        </div>
      </section>

      <section className="card">
        <h2>Import (JSON)</h2>
        <p className="muted">
          Format: Array von Fragen mit topic, difficulty, text, options, correctIndex, explanation, legalBasis,
          legalStatus, sourceNote, status.
        </p>
        <textarea rows={5} value={importText} onChange={(e) => setImportText(e.target.value)} />
        <div className="row" style={{ marginTop: 8 }}>
          <button onClick={importJson} disabled={importText.trim().length === 0}>
            Importieren
          </button>
        </div>
      </section>

      <section className="card">
        <h2>Katalog</h2>
        <div className="row" style={{ marginBottom: 12 }}>
          <div>
            <label>Status</label>
            <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
              <option value="">alle</option>
              {statuses.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>Themengebiet</label>
            <select value={filterTopic} onChange={(e) => setFilterTopic(e.target.value)}>
              <option value="">alle</option>
              {topics.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Frage</th>
              <th>Status</th>
              <th>Recht</th>
              <th>Aktionen</th>
            </tr>
          </thead>
          <tbody>
            {questions.map((question) => (
              <tr key={question.id}>
                <td>{question.id}</td>
                <td>
                  {question.text}
                  <div className="muted">
                    {question.topic.replaceAll('_', ' ')} &middot; {question.difficulty}
                  </div>
                </td>
                <td>
                  <span className="pill">{question.status}</span>
                </td>
                <td>
                  <span className={question.legalStatus === 'verified' ? 'pill ok' : 'pill warn'}>
                    {question.legalStatus}
                  </span>
                </td>
                <td>
                  <div className="row">
                    <button className="small" onClick={() => edit(question)}>
                      bearbeiten
                    </button>
                    <button
                      className="small"
                      onClick={async () => {
                        await api.setQuestionStatus(question.id, 'approved');
                        await loadQuestions();
                      }}
                    >
                      freigeben
                    </button>
                    <button
                      className="small danger"
                      onClick={async () => {
                        if (confirm(`Frage #${question.id} loeschen?`)) {
                          await api.deleteQuestion(question.id);
                          await loadQuestions();
                        }
                      }}
                    >
                      loeschen
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {questions.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  Keine Fragen gefunden.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </>
  );
}
