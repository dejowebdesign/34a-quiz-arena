import type { Server as HttpServer } from 'node:http';
import { Server as SocketServer, type Socket } from 'socket.io';
import {
  C2S,
  S2C,
  type InviteLinksView,
  type Role,
  type TeamId,
  type JokerType,
  type QuestionStatus,
} from '@quiz/shared';
import type { Config } from '../config.js';
import type { Auth } from '../http/auth.js';
import type { CertificateRepository } from '../db/certificates.js';
import type { QuestionRepository } from '../db/questions.js';
import type { GameEngine } from '../engine/game.js';
import { GameRuleError } from '../engine/game.js';
import { audienceView, candidateView, moderatorView } from '../engine/projections.js';
import type { SessionManager } from '../engine/session-manager.js';
import { randomId } from '../crypto.js';

interface SocketData {
  role: Role | null;
  sessionCode: string | null;
  playerId: string | null;
  audienceToken: string | null;
}

interface Deps {
  config: Config;
  auth: Auth;
  sessions: SessionManager;
  questions: QuestionRepository;
  certificates: CertificateRepository;
}

function emitError(socket: Socket, error: unknown): void {
  if (error instanceof GameRuleError) {
    socket.emit(S2C.error, { code: error.code, message: error.message });
    return;
  }
  socket.emit(S2C.error, {
    code: 'server_error',
    message: error instanceof Error ? error.message : 'Unbekannter Fehler.',
  });
}

export function createRealtime(server: HttpServer, deps: Deps) {
  const io = new SocketServer(server, {
    cors: deps.config.allowedOrigins ? { origin: deps.config.allowedOrigins, credentials: true } : undefined,
    maxHttpBufferSize: 1e6,
  });

  /** Pro Engine eine Menge beteiligter Sockets, um Aenderungen zu verteilen. */
  const subscriptions = new Map<string, Set<Socket>>();
  const unsubscribers = new Map<string, () => void>();

  function subscribe(socket: Socket, engine: GameEngine): void {
    const code = engine.state.code;
    let set = subscriptions.get(code);
    if (!set) {
      set = new Set();
      subscriptions.set(code, set);
    }
    set.add(socket);
    if (!unsubscribers.has(code)) {
      unsubscribers.set(
        code,
        engine.onChange(() => {
          for (const client of subscriptions.get(code) ?? []) pushView(client);
        }),
      );
    }
  }

  function unsubscribe(socket: Socket): void {
    for (const [code, set] of subscriptions) {
      set.delete(socket);
      if (set.size === 0) {
        unsubscribers.get(code)?.();
        unsubscribers.delete(code);
        subscriptions.delete(code);
      }
    }
  }

  /**
   * Zentrale Sichtverteilung. Die Rolle entscheidet ueber die Projektion, damit
   * die richtige Antwort nur an die Moderatorensicht gelangt, solange die Frage
   * nicht freigegeben wurde.
   */
  function pushView(socket: Socket): void {
    const data = socket.data as SocketData;
    if (!data.sessionCode) return;
    const engine = deps.sessions.get(data.sessionCode);
    if (!engine) return;
    if (data.role === 'moderator') {
      socket.emit(S2C.view, moderatorView(engine, { invites: invitesFor(engine) }));
      return;
    }
    if (data.role === 'candidate' && data.playerId) {
      const player = engine.state.players.get(data.playerId);
      if (!player) {
        socket.emit(S2C.error, { code: 'unknown_player', message: 'Kandidat existiert nicht mehr.' });
        return;
      }
      socket.emit(S2C.view, candidateView(engine, player));
      return;
    }
    if (data.role === 'audience') {
      socket.emit(S2C.view, audienceView(engine, data.audienceToken));
    }
  }

  /**
   * Einladungspfade fuer die Moderatorensicht. Die Passe werden nur hier
   * signiert und enthalten weder Moderatorenrechte noch die richtige Antwort.
   */
  function invitesFor(engine: GameEngine): InviteLinksView {
    return {
      candidatePath: `#/c/${deps.sessions.issueInvite(engine, 'candidate')}`,
      audiencePath: `#/a/${deps.sessions.issueInvite(engine, 'audience')}`,
      version: engine.state.inviteVersion,
    };
  }

  function requireModerator(socket: Socket): boolean {
    const data = socket.data as SocketData;
    if (data.role !== 'moderator') {
      socket.emit(S2C.error, { code: 'forbidden', message: 'Diese Aktion ist der Moderation vorbehalten.' });
      return false;
    }
    return true;
  }

  function engineFor(socket: Socket): GameEngine | null {
    const data = socket.data as SocketData;
    if (!data.sessionCode) {
      socket.emit(S2C.error, { code: 'no_session', message: 'Keine Show verbunden.' });
      return null;
    }
    const engine = deps.sessions.get(data.sessionCode);
    if (!engine) {
      socket.emit(S2C.error, { code: 'not_found', message: 'Show nicht gefunden.' });
      return null;
    }
    return engine;
  }

  io.on('connection', (socket) => {
    const data = socket.data as SocketData;
    data.role = null;
    data.sessionCode = null;
    data.playerId = null;
    data.audienceToken = null;

    socket.on(C2S.moderatorCreate, (payload: { name?: string; token?: string } = {}) => {
      try {
        if (!payload.token || !deps.auth.tokenIsModerator(payload.token)) {
          socket.emit(S2C.error, { code: 'unauthorized', message: 'Moderatorenanmeldung erforderlich.' });
          return;
        }
        const engine = deps.sessions.createSession(payload.name ?? '');
        data.role = 'moderator';
        data.sessionCode = engine.state.code;
        subscribe(socket, engine);
        socket.emit(S2C.joined, { role: 'moderator', sessionCode: engine.state.code });
        pushView(socket);
      } catch (error) {
        emitError(socket, error);
      }
    });

    socket.on(C2S.moderatorJoin, (payload: { token?: string; code?: string } = {}) => {
      try {
        if (!payload.token || !deps.auth.tokenIsModerator(payload.token)) {
          socket.emit(S2C.error, { code: 'unauthorized', message: 'Moderatorenanmeldung erforderlich.' });
          return;
        }
        const engine = deps.sessions.get(payload.code ?? '');
        if (!engine) {
          socket.emit(S2C.error, { code: 'not_found', message: 'Show nicht gefunden.' });
          return;
        }
        data.role = 'moderator';
        data.sessionCode = engine.state.code;
        subscribe(socket, engine);
        socket.emit(S2C.joined, { role: 'moderator', sessionCode: engine.state.code });
        pushView(socket);
      } catch (error) {
        emitError(socket, error);
      }
    });

    // Kandidaten und Publikum treten ausschliesslich mit signiertem Ticket bei.
    socket.on(C2S.candidateJoin, (payload: { ticket?: string } = {}) => {
      try {
        const ticket = payload.ticket ? deps.sessions.verifyTicket(payload.ticket) : null;
        if (!ticket || ticket.role !== 'candidate' || !ticket.playerId) {
          socket.emit(S2C.error, { code: 'unauthorized', message: 'Ungueltiges Kandidaten-Ticket.' });
          return;
        }
        const engine = deps.sessions.get(ticket.sessionCode);
        if (!engine || !engine.state.players.has(ticket.playerId)) {
          socket.emit(S2C.error, { code: 'not_found', message: 'Kandidat oder Show nicht gefunden.' });
          return;
        }
        data.role = 'candidate';
        data.sessionCode = engine.state.code;
        data.playerId = ticket.playerId;
        subscribe(socket, engine);
        socket.emit(S2C.joined, { role: 'candidate', sessionCode: engine.state.code });
        pushView(socket);
      } catch (error) {
        emitError(socket, error);
      }
    });

    socket.on(C2S.audienceJoin, (payload: { ticket?: string } = {}) => {
      try {
        const ticket = payload.ticket ? deps.sessions.verifyTicket(payload.ticket) : null;
        if (!ticket || ticket.role !== 'audience') {
          socket.emit(S2C.error, { code: 'unauthorized', message: 'Ungueltiges Publikums-Ticket.' });
          return;
        }
        const engine = deps.sessions.get(ticket.sessionCode);
        if (!engine) {
          socket.emit(S2C.error, { code: 'not_found', message: 'Show nicht gefunden.' });
          return;
        }
        data.role = 'audience';
        data.sessionCode = engine.state.code;
        // Stabiler Token pro Socket, damit eine Stimme pro Geraet zaehlt.
        data.audienceToken = ticket.name ?? randomId();
        subscribe(socket, engine);
        socket.emit(S2C.joined, { role: 'audience', sessionCode: engine.state.code });
        pushView(socket);
      } catch (error) {
        emitError(socket, error);
      }
    });

    // ------------------------------------------------------------ Kandidat

    socket.on(C2S.answer, (payload: { optionIndex?: number } = {}) => {
      try {
        const data2 = socket.data as SocketData;
        if (data2.role !== 'candidate' || !data2.playerId) {
          socket.emit(S2C.error, { code: 'forbidden', message: 'Nur Kandidaten koennen antworten.' });
          return;
        }
        const engine = engineFor(socket);
        if (!engine) return;
        engine.submitAnswer(data2.playerId, Number(payload.optionIndex));
        pushView(socket);
      } catch (error) {
        emitError(socket, error);
        pushView(socket);
      }
    });

    // ------------------------------------------------------------ Publikum

    socket.on(C2S.audienceVote, (payload: { optionIndex?: number } = {}) => {
      try {
        const data2 = socket.data as SocketData;
        if (data2.role !== 'audience' || !data2.audienceToken) {
          socket.emit(S2C.error, { code: 'forbidden', message: 'Nur das Publikum kann abstimmen.' });
          return;
        }
        const engine = engineFor(socket);
        if (!engine) return;
        engine.castAudienceVote(data2.audienceToken, Number(payload.optionIndex));
        pushView(socket);
      } catch (error) {
        emitError(socket, error);
        pushView(socket);
      }
    });

    // ----------------------------------------------------------- Moderation

    const moderatorAction = <T>(handler: (engine: GameEngine, payload: T) => void | Promise<void>) =>
      async (payload: T) => {
        if (!requireModerator(socket)) return;
        const engine = engineFor(socket);
        if (!engine) return;
        try {
          await handler(engine, payload);
        } catch (error) {
          emitError(socket, error);
        }
        pushView(socket);
      };

    socket.on(C2S.startGame, moderatorAction<void>((engine) => engine.startGame()));
    socket.on(C2S.spinWheel, moderatorAction<{ team?: TeamId }>((engine, payload) => {
      engine.spinWheel(payload?.team ?? engine.state.activeTeam);
    }));

    socket.on(C2S.startQuestion, moderatorAction<{ questionId?: number; random?: boolean }>((engine, payload) => {
      if (typeof payload?.questionId === 'number') {
        const question = deps.questions.get(payload.questionId);
        if (!question) throw new GameRuleError('not_found', 'Frage nicht gefunden.');
        engine.startQuestion(question);
        return;
      }
      // Zufaellige freigegebene Frage, bevorzugt passend zur Schwierigkeit der Stufe.
      const pool = deps.questions.approved();
      if (pool.length === 0) {
        throw new GameRuleError('no_questions', 'Es sind keine freigegebenen Fragen vorhanden.');
      }
      const target = Math.min(pool.length - 1, Math.floor(Math.random() * pool.length));
      engine.startQuestion(pool[target] as (typeof pool)[number]);
    }));

    socket.on(C2S.clearQuestion, moderatorAction<void>((engine) => engine.clearQuestion()));
    socket.on(C2S.startCountdown, moderatorAction<void>((engine) => engine.startCountdown()));
    socket.on(C2S.pauseCountdown, moderatorAction<void>((engine) => engine.pauseCountdown()));
    socket.on(C2S.resumeCountdown, moderatorAction<void>((engine) => engine.resumeCountdown()));
    socket.on(C2S.reveal, moderatorAction<void>((engine) => {
      engine.reveal();
    }));
    socket.on(C2S.nextTeam, moderatorAction<void>((engine) => engine.nextTeam()));
    socket.on(C2S.closeJoker, moderatorAction<void>((engine) => engine.closeJoker()));
    socket.on(C2S.resetGame, moderatorAction<void>((engine) => engine.resetGame()));
    socket.on(C2S.activateJoker, moderatorAction<{ type?: JokerType; team?: TeamId }>(async (engine, payload) => {
      if (!payload?.type) throw new GameRuleError('bad_request', 'Jokertyp fehlt.');
      await engine.activateJoker(payload.type, payload.team ?? engine.state.activeTeam);
    }));
    socket.on(C2S.setOpenJoin, moderatorAction<{ open?: boolean }>((engine, payload) => {
      engine.setOpenJoin(Boolean(payload?.open));
    }));
    socket.on(C2S.setSafetyLevels, moderatorAction<{ team?: TeamId; levels?: number[] }>((engine, payload) => {
      if (payload?.team !== 'A' && payload?.team !== 'B') throw new GameRuleError('bad_request', 'Team fehlt.');
      engine.setSafetyLevels(payload.team, Array.isArray(payload.levels) ? payload.levels : []);
    }));

    socket.on('disconnect', () => {
      unsubscribe(socket);
    });
  });

  return { io, pushView };
}

export type Realtime = ReturnType<typeof createRealtime>;
export type { QuestionStatus };
