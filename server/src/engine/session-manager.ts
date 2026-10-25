import { randomCode, randomId, signToken, verifyToken } from '../crypto.js';
import type { CertificateRepository } from '../db/certificates.js';
import { GameEngine, type Clock, type HintProvider } from './game.js';
import type { Role, TeamId } from '@quiz/shared';

export interface JoinTicket {
  role: Role;
  sessionCode: string;
  playerId?: string;
  name?: string;
  team?: TeamId;
}

export interface SessionHandle {
  engine: GameEngine;
  dispose(): void;
}

/**
 * Verwaltet alle laufenden Shows im Speicher und stellt signierte,
 * faelschungssichere Join-Tickets aus. Der Spielzustand ist bewusst
 * serverseitig und wird nie vom Client uebernommen.
 */
export class SessionManager {
  private readonly sessions = new Map<string, SessionHandle>();
  private readonly playersToSession = new Map<string, string>();

  constructor(
    private readonly options: {
      secret: string;
      clock?: Clock;
      hintProvider?: HintProvider;
      certificates: CertificateRepository;
      onEngineChange?: (engine: GameEngine) => void;
    },
  ) {}

  createSession(name: string): GameEngine {
    let code = randomCode(6);
    while (this.sessions.has(code)) code = randomCode(6);
    const engine = new GameEngine({
      code,
      name: name.trim() || `Show ${code}`,
      clock: this.options.clock,
      hintProvider: this.options.hintProvider,
    });
    // Bereits ausgestellte Zertifikate laden, damit sie nach Neustart sichtbar bleiben.
    for (const record of this.options.certificates.list(500)) engine.state.certificates.push(record);
    const handle: SessionHandle = {
      engine,
      dispose: () => engine.dispose(),
    };
    this.sessions.set(code, handle);
    engine.onChange(() => this.options.onEngineChange?.(engine));
    return engine;
  }

  get(code: string): GameEngine | null {
    return this.sessions.get(code.toUpperCase())?.engine ?? null;
  }

  codes(): string[] {
    return [...this.sessions.keys()];
  }

  remove(code: string): void {
    const handle = this.sessions.get(code);
    if (!handle) return;
    handle.dispose();
    this.sessions.delete(code);
  }

  /** Ticket fuer Moderator, Kandidat oder Publikum ausstellen. */
  issueTicket(ticket: JoinTicket): string {
    return signToken({ ...ticket }, this.options.secret, 12 * 60 * 60 * 1000);
  }

  verifyTicket(token: string): JoinTicket | null {
    const payload = verifyToken<JoinTicket>(token, this.options.secret);
    if (!payload) return null;
    return { role: payload.role, sessionCode: payload.sessionCode, playerId: payload.playerId, name: payload.name, team: payload.team };
  }

  /** Kandidat anlegen und Ticket zurueckgeben. */
  registerCandidate(engine: GameEngine, name: string, team: TeamId): { playerId: string; token: string } {
    const player = engine.addPlayer(name, team);
    this.playersToSession.set(player.id, engine.state.code);
    const token = this.issueTicket({ role: 'candidate', sessionCode: engine.state.code, playerId: player.id, name: player.name, team });
    return { playerId: player.id, token };
  }

  audienceToken(engine: GameEngine): string {
    return this.issueTicket({ role: 'audience', sessionCode: engine.state.code, name: `audience-${randomId().slice(0, 8)}` });
  }
}
