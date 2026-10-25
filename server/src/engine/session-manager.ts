import { randomCode, randomId, signToken, verifyToken } from '../crypto.js';
import type { CertificateRepository } from '../db/certificates.js';
import { GameEngine, type ApprovedQuestionCountProvider, type Clock, type HintProvider } from './game.js';
import type { Role, TeamId } from '@quiz/shared';

export interface JoinTicket {
  role: Role;
  sessionCode: string;
  playerId?: string;
  name?: string;
  team?: TeamId;
}

/**
 * Signierter, widerrufbarer Einladungspass. Er enthaelt weder Moderatorenrechte
 * noch die richtige Antwort. Der Kandidatenpass traegt optional eine
 * voreingestellte Teamzuordnung; das Publikum erhaelt pro Geraet ein eigenes
 * Zugangsticket.
 */
export interface InvitePass {
  role: 'invite';
  kind: 'candidate' | 'audience';
  sessionCode: string;
  version: number;
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
      approvedQuestionCount?: ApprovedQuestionCountProvider;
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
      approvedQuestionCount: this.options.approvedQuestionCount,
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

  /**
   * Einladungspass ausstellen. Die TTL ist bewusst lang, weil eine Show auch
   * ueber einen ganzen Abend laufen kann; widerrufen wird ueber die
   * inviteVersion des Spiels, nicht ueber die Zeit.
   */
  issueInvite(engine: GameEngine, kind: 'candidate' | 'audience', team?: TeamId): string {
    const pass: InvitePass = {
      role: 'invite',
      kind,
      sessionCode: engine.state.code,
      version: engine.state.inviteVersion,
      ...(team ? { team } : {}),
    };
    return signToken({ ...pass }, this.options.secret, 24 * 60 * 60 * 1000);
  }

  /**
   * Einladungspass pruefen. Der Pass ist nur gueltig, solange die Show laeuft
   * und die inviteVersion unveraendert ist. Ein Widerruf macht damit alle
   * bisher ausgegebenen Links sofort ungueltig.
   */
  verifyInvite(pass: string, kind: 'candidate' | 'audience'): { engine: GameEngine; pass: InvitePass } | null {
    const payload = verifyToken<InvitePass>(pass, this.options.secret);
    if (!payload || payload.role !== 'invite' || payload.kind !== kind) return null;
    const engine = this.get(payload.sessionCode);
    if (!engine) return null;
    if (payload.version !== engine.state.inviteVersion) return null;
    return { engine, pass: payload };
  }

  /** Kandidat anlegen und Ticket zurueckgeben. */
  registerCandidate(engine: GameEngine, name: string, team: TeamId): { playerId: string; token: string } {
    const player = engine.addPlayer(name, team);
    this.playersToSession.set(player.id, engine.state.code);
    const token = this.issueTicket({ role: 'candidate', sessionCode: engine.state.code, playerId: player.id, name: player.name, team });
    return { playerId: player.id, token };
  }

  /**
   * Publikumszugang fuer genau ein Geraet. Der zufaellige Name im Ticket wird
   * zum Stimmschluessel; dadurch zaehlt auch bei einem geteilten Einladungslink
   * jede Person beziehungsweise jedes Geraet genau einmal.
   */
  audienceToken(engine: GameEngine): string {
    return this.issueTicket({ role: 'audience', sessionCode: engine.state.code, name: `audience-${randomId().slice(0, 8)}` });
  }
}
