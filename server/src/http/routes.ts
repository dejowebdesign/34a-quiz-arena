import express, { type Router } from 'express';
import rateLimit from 'express-rate-limit';
import {
  DIFFICULTIES,
  LEGAL_STATUS_LABELS,
  MIN_APPROVED_QUESTIONS,
  QUESTION_STATUS_LABELS,
  TOPIC_LABELS,
  TOPICS,
  type QuestionStatus,
  type TeamId,
  type Topic,
} from '@quiz/shared';
import type { Auth } from './auth.js';
import type { Config } from '../config.js';
import { CERTIFICATE_DISCLAIMER, CertificateRepository } from '../db/certificates.js';
import { QuestionRepository, ValidationError, validateQuestionInput } from '../db/questions.js';
import { GameRuleError } from '../engine/game.js';
import type { SessionManager } from '../engine/session-manager.js';

export interface RouteDeps {
  config: Config;
  auth: Auth;
  questions: QuestionRepository;
  certificates: CertificateRepository;
  sessions: SessionManager;
}

const loginLimiter = rateLimit({ windowMs: 10 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false });

export function createRoutes(deps: RouteDeps): Router {
  const router = express.Router();
  const json = express.json({ limit: '2mb' });

  router.get('/health', (_req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString(), approvedQuestions: deps.questions.countApproved() });
  });

  router.get('/meta', (_req, res) => {
    res.json({
      topics: TOPICS.map((topic) => ({ id: topic, label: TOPIC_LABELS[topic] })),
      difficulties: DIFFICULTIES.map((d) => ({ id: d, label: d })),
      questionStatuses: Object.entries(QUESTION_STATUS_LABELS).map(([id, label]) => ({ id, label })),
      legalStatuses: Object.entries(LEGAL_STATUS_LABELS).map(([id, label]) => ({ id, label })),
      certificateDisclaimer: CERTIFICATE_DISCLAIMER,
    });
  });

  // ------------------------------------------------------- Oeffentliche Lobby
  // Diese Endpunkte sind bewusst ohne Moderatorenzugang erreichbar, damit
  // Kandidaten und Publikum beitreten koennen. Der Selbstbeitritt ist nur
  // moeglich, wenn die Moderation ihn ausdruecklich freigegeben hat.

  router.get('/public/sessions/:code', (req, res) => {
    const engine = deps.sessions.get(req.params.code ?? '');
    if (!engine) {
      res.status(404).json({ code: 'not_found', message: 'Show nicht gefunden.' });
      return;
    }
    const state = engine.state;
    const teams = (['A', 'B'] as const).map((team) => ({
      id: team,
      name: state.teams[team].name,
      playerCount: engine.teamPlayers(team).length,
      players: engine.teamPlayers(team).map((player) => player.name),
    }));
    res.json({ code: state.code, name: state.name, openJoin: state.openJoin, teams });
  });

  router.post('/public/sessions/:code/join', json, (req, res) => {
    const engine = deps.sessions.get(req.params.code ?? '');
    if (!engine) {
      res.status(404).json({ code: 'not_found', message: 'Show nicht gefunden.' });
      return;
    }
    if (!engine.state.openJoin) {
      res.status(403).json({ code: 'join_closed', message: 'Der Beitritt ist gesperrt. Bitte die Moderation fragen.' });
      return;
    }
    const { name, team } = (req.body ?? {}) as { name?: string; team?: TeamId };
    if (typeof name !== 'string' || (team !== 'A' && team !== 'B')) {
      res.status(400).json({ code: 'bad_request', message: 'Name und Team (A oder B) sind erforderlich.' });
      return;
    }
    try {
      const { playerId, token } = deps.sessions.registerCandidate(engine, name, team);
      res.status(201).json({ playerId, token, team, sessionCode: engine.state.code });
    } catch (error) {
      res.status(409).json({ code: 'rule_violation', message: error instanceof Error ? error.message : 'Fehler' });
    }
  });

  router.post('/public/sessions/:code/audience', (req, res) => {
    const engine = deps.sessions.get(req.params.code ?? '');
    if (!engine) {
      res.status(404).json({ code: 'not_found', message: 'Show nicht gefunden.' });
      return;
    }
    res.json({ token: deps.sessions.audienceToken(engine) });
  });

  // ------------------------------------------------- Einladungen ueber Passe
  // Der Moderator erzeugt die Links; die Passe sind signiert und widerrufbar.
  // Kandidaten und Publikum bekommen je einen eigenen Pass, damit ein
  // Publikumslink niemals zur Antwortabgabe fuehrt und umgekehrt.

  router.get('/public/sessions/:code/invites', (req, res) => {
    const engine = deps.sessions.get(req.params.code ?? '');
    if (!engine) {
      res.status(404).json({ code: 'not_found', message: 'Show nicht gefunden.' });
      return;
    }
    res.json({
      code: engine.state.code,
      name: engine.state.name,
      openJoin: engine.state.openJoin,
      candidatePath: `#/c/${deps.sessions.issueInvite(engine, 'candidate')}`,
      audiencePath: `#/a/${deps.sessions.issueInvite(engine, 'audience')}`,
    });
  });

  // Prueft einen Kandidatenpass und liefert die noch noetigen Angaben.
  router.get('/public/invite/:pass', (req, res) => {
    const verified = deps.sessions.verifyInvite(req.params.pass ?? '', 'candidate');
    if (!verified) {
      res.status(404).json({ code: 'invalid_invite', message: 'Diese Einladung ist ungueltig oder wurde widerrufen.' });
      return;
    }
    const { engine, pass } = verified;
    const state = engine.state;
    res.json({
      sessionCode: state.code,
      sessionName: state.name,
      openJoin: state.openJoin,
      suggestedTeam: pass.team ?? null,
      teams: (['A', 'B'] as const).map((team) => ({
        id: team,
        name: state.teams[team].name,
        playerCount: engine.teamPlayers(team).length,
      })),
    });
  });

  // Kandidatenbeitritt ueber Einladungspass. Der gueltige, signierte Pass ist
  // die Berechtigung: kein Show-Code, keine PIN. Die Moderation behaelt die
  // Kontrolle, weil sie Links jederzeit widerrufen kann.
  router.post('/public/join/:pass', json, (req, res) => {
    const verified = deps.sessions.verifyInvite(req.params.pass ?? '', 'candidate');
    if (!verified) {
      res.status(404).json({ code: 'invalid_invite', message: 'Diese Einladung ist ungueltig oder wurde widerrufen.' });
      return;
    }
    const { engine, pass } = verified;
    const { name, team } = (req.body ?? {}) as { name?: string; team?: TeamId };
    const chosen = team ?? pass.team;
    if (typeof name !== 'string' || (chosen !== 'A' && chosen !== 'B')) {
      res.status(400).json({ code: 'bad_request', message: 'Name und Team (A oder B) sind erforderlich.' });
      return;
    }
    try {
      const { playerId, token } = deps.sessions.registerCandidate(engine, name, chosen);
      res.status(201).json({ playerId, token, team: chosen, sessionCode: engine.state.code });
    } catch (error) {
      res.status(409).json({ code: 'rule_violation', message: error instanceof Error ? error.message : 'Fehler' });
    }
  });

  // Publikumszugang ueber Einladungspass. Pro Aufruf entsteht ein eigenes
  // Geraeteticket, damit Mehrfachabstimmung ueber einen geteilten Link entfaellt.
  router.post('/public/audience/:pass', (req, res) => {
    const verified = deps.sessions.verifyInvite(req.params.pass ?? '', 'audience');
    if (!verified) {
      res.status(404).json({ code: 'invalid_invite', message: 'Diese Einladung ist ungueltig oder wurde widerrufen.' });
      return;
    }
    res.json({ token: deps.sessions.audienceToken(verified.engine), sessionCode: verified.engine.state.code });
  });

  // Zertifikate sind fuer die ausstellende Person abrufbar (Link/QR auf der
  // Abschlussseite). Sie enthalten keine Geheimnisse.
  router.get('/public/certificates/:id', (req, res) => {
    const certificate = deps.certificates.get(req.params.id ?? '');
    if (!certificate) {
      res.status(404).json({ code: 'not_found', message: 'Zertifikat nicht gefunden.' });
      return;
    }
    res.json({ certificate, disclaimer: CERTIFICATE_DISCLAIMER });
  });

  // ------------------------------------------------------------- Moderation

  router.post('/auth/moderator', loginLimiter, json, async (req, res) => {
    const { user, password } = (req.body ?? {}) as { user?: string; password?: string };
    if (typeof user !== 'string' || typeof password !== 'string') {
      res.status(400).json({ code: 'bad_request', message: 'Benutzer und Passwort sind erforderlich.' });
      return;
    }
    if (!(await deps.auth.checkCredentials(user, password))) {
      res.status(401).json({ code: 'unauthorized', message: 'Zugangsdaten sind ungueltig.' });
      return;
    }
    res.json({ token: deps.auth.issueModeratorToken(), role: 'moderator' });
  });

  // Ab hier ist ein Moderatorenzugang erforderlich.
  router.use(deps.auth.basicAuth);

  router.post('/sessions', json, (req, res) => {
    const { name } = (req.body ?? {}) as { name?: string };
    const engine = deps.sessions.createSession(typeof name === 'string' ? name : '');
    res.status(201).json({ code: engine.state.code, name: engine.state.name });
  });

  router.get('/sessions', (_req, res) => {
    res.json({ codes: deps.sessions.codes() });
  });

  // Kandidaten registrieren (nur Moderation, damit keine Fremden beitreten).
  router.post('/sessions/:code/players', json, (req, res) => {
    const engine = deps.sessions.get(req.params.code ?? '');
    if (!engine) {
      res.status(404).json({ code: 'not_found', message: 'Show nicht gefunden.' });
      return;
    }
    const { name, team } = (req.body ?? {}) as { name?: string; team?: TeamId };
    if (typeof name !== 'string' || (team !== 'A' && team !== 'B')) {
      res.status(400).json({ code: 'bad_request', message: 'Name und Team (A oder B) sind erforderlich.' });
      return;
    }
    try {
      const { playerId, token } = deps.sessions.registerCandidate(engine, name, team);
      res.status(201).json({ playerId, token, team, sessionCode: engine.state.code });
    } catch (error) {
      res.status(409).json({ code: 'rule_violation', message: error instanceof Error ? error.message : 'Fehler' });
    }
  });

  router.delete('/sessions/:code/players/:playerId', (req, res) => {
    const engine = deps.sessions.get(req.params.code ?? '');
    if (!engine) {
      res.status(404).json({ code: 'not_found', message: 'Show nicht gefunden.' });
      return;
    }
    try {
      engine.removePlayer(req.params.playerId ?? '');
      res.status(204).end();
    } catch (error) {
      res.status(409).json({ code: 'rule_violation', message: error instanceof Error ? error.message : 'Fehler' });
    }
  });

  router.post('/sessions/:code/audience-token', (req, res) => {
    const engine = deps.sessions.get(req.params.code ?? '');
    if (!engine) {
      res.status(404).json({ code: 'not_found', message: 'Show nicht gefunden.' });
      return;
    }
    res.json({ token: deps.sessions.audienceToken(engine) });
  });

  /**
   * Show starten. Serverseitige Pruefung: ohne mindestens MIN_APPROVED_QUESTIONS
   * freigegebene Fragen wird der Start abgelehnt.
   */
  router.post('/sessions/:code/start', (req, res) => {
    const engine = deps.sessions.get(req.params.code ?? '');
    if (!engine) {
      res.status(404).json({ code: 'not_found', message: 'Show nicht gefunden.' });
      return;
    }
    try {
      engine.startGame();
      res.json({
        started: true,
        playableQuestions: engine.playableQuestionCount(),
        minQuestions: MIN_APPROVED_QUESTIONS,
      });
    } catch (error) {
      if (error instanceof GameRuleError) {
        res.status(error.code === 'not_enough_questions' ? 409 : 400).json({
          code: error.code,
          message: error.message,
          playableQuestions: engine.playableQuestionCount(),
          minQuestions: MIN_APPROVED_QUESTIONS,
        });
        return;
      }
      res.status(400).json({ code: 'bad_request', message: error instanceof Error ? error.message : 'Fehler' });
    }
  });

  /** Alle bisher ausgegebenen Einladungslinks widerrufen. */
  router.post('/sessions/:code/invites/rotate', (req, res) => {
    const engine = deps.sessions.get(req.params.code ?? '');
    if (!engine) {
      res.status(404).json({ code: 'not_found', message: 'Show nicht gefunden.' });
      return;
    }
    engine.revokeInvites();
    res.json({
      version: engine.state.inviteVersion,
      candidatePath: `#/c/${deps.sessions.issueInvite(engine, 'candidate')}`,
      audiencePath: `#/a/${deps.sessions.issueInvite(engine, 'audience')}`,
    });
  });

  // ------------------------------------------------------------- Fragenkatalog

  router.get('/questions', (req, res) => {
    const status = req.query.status as QuestionStatus | undefined;
    const topic = req.query.topic as Topic | undefined;
    res.json({ questions: deps.questions.list({ status, topic }) });
  });

  router.post('/questions', json, (req, res) => {
    try {
      const question = deps.questions.create(validateQuestionInput(req.body));
      res.status(201).json({ question });
    } catch (error) {
      if (error instanceof ValidationError) {
        res.status(422).json({ code: 'validation_error', message: error.message, details: error.details });
        return;
      }
      res.status(400).json({ code: 'bad_request', message: error instanceof Error ? error.message : 'Fehler' });
    }
  });

  router.put('/questions/:id', json, (req, res) => {
    const id = Number(req.params.id);
    try {
      const question = deps.questions.update(id, validateQuestionInput(req.body));
      if (!question) {
        res.status(404).json({ code: 'not_found', message: 'Frage nicht gefunden.' });
        return;
      }
      res.json({ question });
    } catch (error) {
      if (error instanceof ValidationError) {
        res.status(422).json({ code: 'validation_error', message: error.message, details: error.details });
        return;
      }
      res.status(400).json({ code: 'bad_request', message: error instanceof Error ? error.message : 'Fehler' });
    }
  });

  router.post('/questions/:id/status', json, (req, res) => {
    const id = Number(req.params.id);
    const { status } = (req.body ?? {}) as { status?: QuestionStatus };
    if (!status || !(status in QUESTION_STATUS_LABELS)) {
      res.status(400).json({ code: 'bad_request', message: 'Unbekannter Status.' });
      return;
    }
    const question = deps.questions.setStatus(id, status);
    if (!question) {
      res.status(404).json({ code: 'not_found', message: 'Frage nicht gefunden.' });
      return;
    }
    res.json({ question });
  });

  router.delete('/questions/:id', (req, res) => {
    const removed = deps.questions.delete(Number(req.params.id));
    res.status(removed ? 204 : 404).end();
  });

  router.post('/questions/import', json, (req, res) => {
    const body = req.body as { questions?: unknown[] } | unknown[];
    const items = Array.isArray(body) ? body : Array.isArray(body?.questions) ? body.questions : null;
    if (!items) {
      res.status(400).json({ code: 'bad_request', message: 'Es wird ein Array "questions" erwartet.' });
      return;
    }
    const result = deps.questions.importMany(items);
    res.status(result.errors.length === 0 ? 201 : 207).json({
      imported: result.created.length,
      failed: result.errors.length,
      errors: result.errors,
      questions: result.created,
    });
  });

  // -------------------------------------------------------------- Zertifikate

  router.get('/certificates', (_req, res) => {
    res.json({ certificates: deps.certificates.list(200), disclaimer: CERTIFICATE_DISCLAIMER });
  });

  return router;
}
