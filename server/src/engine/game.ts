import {
  applyCorrectAnswer,
  applyWrongAnswer,
  createWheel,
  drawFromWheel,
  normalizeSafetyLevels,
  safetyFloorFor,
  syncWheelPlayers,
  COUNTDOWN_MS,
  DEFAULT_SAFETY_LEVELS,
  JOKER_LABELS,
  LADDER_MAX_LEVEL,
  OPTION_COUNT,
  TEAM_IDS,
  TEAM_LABELS,
  type AnswerOutcome,
  type CountdownState,
  type JokerStatus,
  type JokerType,
  type Phase,
  type QuestionRecord,
  type TeamId,
  type WheelState,
} from '@quiz/shared';
import { randomId } from '../crypto.js';
import type { CertificateRecord } from '../db/certificates.js';

export interface Player {
  id: string;
  name: string;
  team: TeamId;
}

export interface AnswerRecord {
  playerId: string;
  playerName: string;
  optionIndex: number;
  at: number;
}

export interface CountdownStateInternal {
  state: CountdownState;
  endsAt: number | null;
  remainingMs: number | null;
}

export interface TeamState {
  id: TeamId;
  name: string;
  level: number;
  floor: number;
  safetyLevels: number[];
  completed: boolean;
  jokers: Record<JokerType, JokerStatus>;
  wheel: WheelState;
}

export interface JokerStateInternal {
  active: JokerType | null;
  forTeam: TeamId | null;
  hiddenOptions: number[];
  aiHint: string | null;
  votes: Map<string, number>;
}

export interface RevealState {
  questionId: number;
  outcome: AnswerOutcome;
  correctIndex: number;
  chosenIndex: number | null;
  explanation: string;
  legalBasis: string | null;
  legalStatus: QuestionRecord['legalStatus'];
  sourceNote: string | null;
  levelBefore: number;
  levelAfter: number;
}

export interface LogEntry {
  at: number;
  text: string;
}

export interface GameState {
  code: string;
  name: string;
  phase: Phase;
  activeTeam: TeamId;
  teams: Record<TeamId, TeamState>;
  players: Map<string, Player>;
  currentQuestion: QuestionRecord | null;
  drawnByTeam: Record<TeamId, string | null>;
  answers: Record<TeamId, AnswerRecord | null>;
  countdown: CountdownStateInternal;
  joker: JokerStateInternal;
  reveal: RevealState | null;
  log: LogEntry[];
  certificates: CertificateRecord[];
  /** Erlaubt Kandidaten den Selbstbeitritt waehrend der Lobby. Standard: aus. */
  openJoin: boolean;
}

export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout),
};

export interface HintProvider {
  (question: QuestionRecord): Promise<string>;
}

export class GameRuleError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'GameRuleError';
    this.code = code;
  }
}

export type ChangeListener = (state: GameState) => void;

function createTeam(id: TeamId): TeamState {
  return {
    id,
    name: TEAM_LABELS[id],
    level: 0,
    floor: 0,
    safetyLevels: [...DEFAULT_SAFETY_LEVELS],
    completed: false,
    jokers: { ai: 'available', audience: 'available', fifty: 'available' },
    wheel: createWheel([]),
  };
}

/**
 * Serverseitige Spielautoritaet. Alle Spielregeln werden hier durchgesetzt.
 * Der Client kann ausschliesslich Anfragen stellen; ueber Gueltigkeit,
 * Punktestand, Zeitsteuerung und Geheimhaltung entscheidet ausschliesslich
 * diese Klasse.
 */
export class GameEngine {
  readonly state: GameState;
  private timerHandle: unknown = null;
  private readonly listeners = new Set<ChangeListener>();
  private readonly clock: Clock;
  private readonly hintProvider: HintProvider;

  constructor(options: { code: string; name: string; clock?: Clock; hintProvider?: HintProvider }) {
    this.clock = options.clock ?? systemClock;
    this.hintProvider = options.hintProvider ?? (async () => '');
    this.state = {
      code: options.code,
      name: options.name,
      phase: 'idle',
      activeTeam: 'A',
      teams: { A: createTeam('A'), B: createTeam('B') },
      players: new Map(),
      currentQuestion: null,
      drawnByTeam: { A: null, B: null },
      answers: { A: null, B: null },
      countdown: { state: 'idle', endsAt: null, remainingMs: null },
      joker: { active: null, forTeam: null, hiddenOptions: [], aiHint: null, votes: new Map() },
      reveal: null,
      log: [],
      certificates: [],
      openJoin: false,
    };
    this.log(`Show "${options.name}" angelegt (Code ${options.code}).`);
  }

  onChange(listener: ChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) listener(this.state);
  }

  private log(text: string): void {
    this.state.log.push({ at: this.clock.now(), text });
    if (this.state.log.length > 200) this.state.log.shift();
  }

  private emit(text: string): void {
    this.log(text);
    this.notify();
  }

  // ---------------------------------------------------------------- Spieler

  addPlayer(name: string, team: TeamId): Player {
    const trimmed = name.trim();
    if (trimmed.length < 2) throw new GameRuleError('invalid_name', 'Der Spielername muss mindestens 2 Zeichen haben.');
    if (!TEAM_IDS.includes(team)) throw new GameRuleError('invalid_team', 'Unbekanntes Team.');
    const duplicate = [...this.state.players.values()].some(
      (p) => p.team === team && p.name.toLowerCase() === trimmed.toLowerCase(),
    );
    if (duplicate) throw new GameRuleError('duplicate_player', `"${trimmed}" existiert in ${TEAM_LABELS[team]} bereits.`);
    const player: Player = { id: randomId(), name: trimmed, team };
    this.state.players.set(player.id, player);
    this.refreshWheel(team);
    this.emit(`Spieler "${trimmed}" zu ${TEAM_LABELS[team]} hinzugefuegt.`);
    return player;
  }

  removePlayer(playerId: string): void {
    const player = this.state.players.get(playerId);
    if (!player) throw new GameRuleError('unknown_player', 'Spieler nicht gefunden.');
    this.state.players.delete(playerId);
    if (this.state.drawnByTeam[player.team] === playerId) this.state.drawnByTeam[player.team] = null;
    this.refreshWheel(player.team);
    this.emit(`Spieler "${player.name}" entfernt.`);
  }

  /** Selbstbeitritt von Kandidaten erlauben oder sperren (Lobby-Steuerung). */
  setOpenJoin(value: boolean): void {
    this.state.openJoin = value;
    this.emit(value ? 'Kandidaten-Selbstbeitritt freigegeben.' : 'Kandidaten-Selbstbeitritt gesperrt.');
  }

  setTeamName(team: TeamId, name: string): void {
    const trimmed = name.trim();
    if (trimmed.length < 2) throw new GameRuleError('invalid_name', 'Der Teamname muss mindestens 2 Zeichen haben.');
    this.state.teams[team].name = trimmed;
    this.emit(`Team umbenannt in "${trimmed}".`);
  }

  teamPlayers(team: TeamId): Player[] {
    return [...this.state.players.values()].filter((p) => p.team === team);
  }

  private refreshWheel(team: TeamId): void {
    const ids = this.teamPlayers(team).map((p) => p.id);
    this.state.teams[team].wheel = syncWheelPlayers(this.state.teams[team].wheel, ids);
  }

  // ------------------------------------------------------------- Gluecksrad

  /** Dreht das Rad. Standardmaessig fuer das aktive Team. */
  spinWheel(team: TeamId = this.state.activeTeam, rng: () => number = Math.random): Player {
    if (this.state.phase === 'question' || this.state.phase === 'joker') {
      throw new GameRuleError('phase_locked', 'Das Rad kann nicht waehrend einer laufenden Frage gedreht werden.');
    }
    const players = this.teamPlayers(team);
    if (players.length === 0) throw new GameRuleError('no_players', `${TEAM_LABELS[team]} hat noch keine Spieler.`);
    const ids = players.map((p) => p.id);
    const result = drawFromWheel(this.state.teams[team].wheel, ids, rng);
    this.state.teams[team].wheel = result.state;
    this.state.drawnByTeam[team] = result.drawn;
    const drawn = this.state.players.get(result.drawn);
    this.emit(
      `Gluecksrad ${TEAM_LABELS[team]}: ${drawn?.name ?? 'Unbekannt'} ausgewaehlt` +
        (result.refilled ? ' (Rad neu aufgefuellt).' : '.'),
    );
    return drawn ?? { id: result.drawn, name: 'Unbekannt', team };
  }

  // -------------------------------------------------------------- Fragen

  /** Startet eine Frage fuer das aktive Team. Nur freigegebene Fragen sind erlaubt. */
  startQuestion(question: QuestionRecord): void {
    if (question.status !== 'approved') {
      throw new GameRuleError('question_not_approved', 'Nur freigegebene Fragen duerfen gestartet werden.');
    }
    if (this.state.phase === 'question' || this.state.phase === 'joker') {
      throw new GameRuleError('question_running', 'Es laeuft bereits eine Frage.');
    }
    this.stopTimer();
    const team = this.state.activeTeam;
    this.state.currentQuestion = question;
    this.state.answers[team] = null;
    this.state.reveal = null;
    this.state.countdown = { state: 'idle', endsAt: null, remainingMs: null };
    this.state.joker = { active: null, forTeam: null, hiddenOptions: [], aiHint: null, votes: new Map() };
    this.state.phase = 'question';
    this.emit(`Frage #${question.id} fuer ${this.state.teams[team].name} gestartet.`);
  }

  /** Beendet die aktuelle Frage ohne Wertung (z. B. Abbruch durch den Moderator). */
  clearQuestion(): void {
    this.stopTimer();
    this.state.currentQuestion = null;
    this.state.reveal = null;
    this.state.answers = { A: null, B: null };
    this.state.countdown = { state: 'idle', endsAt: null, remainingMs: null };
    this.state.joker = { active: null, forTeam: null, hiddenOptions: [], aiHint: null, votes: new Map() };
    this.state.phase = 'idle';
    this.emit('Frage abgebrochen.');
  }

  // ------------------------------------------------------------ Zeitsteuerung

  /** Startet die letzten zehn Sekunden. Ohne Automatik - nur auf Anweisung. */
  startCountdown(durationMs: number = COUNTDOWN_MS): void {
    if (this.state.phase !== 'question' && this.state.phase !== 'joker') {
      throw new GameRuleError('no_question', 'Es laeuft keine Frage, fuer die ein Countdown gestartet werden kann.');
    }
    if (this.state.countdown.state === 'running') {
      throw new GameRuleError('countdown_running', 'Der Countdown laeuft bereits.');
    }
    this.armTimer(durationMs);
    this.emit('Countdown gestartet (letzte zehn Sekunden).');
  }

  pauseCountdown(): void {
    if (this.state.countdown.state !== 'running' || this.state.countdown.endsAt === null) {
      throw new GameRuleError('countdown_not_running', 'Es laeuft kein Countdown.');
    }
    const remaining = Math.max(0, this.state.countdown.endsAt - this.clock.now());
    this.stopTimer();
    this.state.countdown = { state: 'paused', endsAt: null, remainingMs: remaining };
    this.emit('Countdown pausiert.');
  }

  resumeCountdown(): void {
    if (this.state.countdown.state !== 'paused' || this.state.countdown.remainingMs === null) {
      throw new GameRuleError('countdown_not_paused', 'Der Countdown ist nicht pausiert.');
    }
    this.armTimer(this.state.countdown.remainingMs);
    this.emit('Countdown fortgesetzt.');
  }

  private armTimer(durationMs: number): void {
    this.stopTimer();
    const duration = Math.max(0, durationMs);
    this.state.countdown = { state: 'running', endsAt: this.clock.now() + duration, remainingMs: null };
    this.timerHandle = this.clock.setTimeout(() => {
      this.timerHandle = null;
      this.state.countdown = { state: 'expired', endsAt: null, remainingMs: 0 };
      this.emit('Antwortzeit abgelaufen - Antwortphase geschlossen.');
      this.notify();
    }, duration);
  }

  private stopTimer(): void {
    if (this.timerHandle !== null) {
      this.clock.clearTimeout(this.timerHandle);
      this.timerHandle = null;
    }
  }

  /** Antwortphase offen? Beruecksichtigt Phase, Abbruch und abgelaufene Zeit. */
  isAnswerable(): boolean {
    if (this.state.phase !== 'question' && this.state.phase !== 'joker') return false;
    if (this.state.countdown.state === 'expired') return false;
    // Sicherheitsnetz: abgelaufene Frist auch ohne Callback (z. B. schlafender Prozess) erkennen.
    if (this.state.countdown.state === 'running' && this.state.countdown.endsAt !== null) {
      if (this.clock.now() >= this.state.countdown.endsAt) return false;
    }
    return true;
  }

  // ---------------------------------------------------------------- Antworten

  /** Verbindliche Antwortabgabe. Nur der gezogene Kandidat des aktiven Teams darf antworten. */
  submitAnswer(playerId: string, optionIndex: number): AnswerRecord {
    const team = this.state.activeTeam;
    const player = this.state.players.get(playerId);
    if (!player) throw new GameRuleError('unknown_player', 'Unbekannter Spieler.');
    if (player.team !== team) throw new GameRuleError('not_your_turn', 'Dieses Team ist nicht am Zug.');
    if (this.state.drawnByTeam[team] !== playerId) {
      throw new GameRuleError('not_drawn', 'Nur der gezogene Kandidat darf antworten.');
    }
    if (!this.isAnswerable()) throw new GameRuleError('answering_closed', 'Die Antwortphase ist geschlossen.');
    if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= OPTION_COUNT) {
      throw new GameRuleError('invalid_option', 'Ungueltige Antwortoption.');
    }
    if (this.state.answers[team] !== null) {
      throw new GameRuleError('already_answered', 'Es wurde bereits eine Antwort abgegeben.');
    }
    const record: AnswerRecord = {
      playerId,
      playerName: player.name,
      optionIndex,
      at: this.clock.now(),
    };
    this.state.answers[team] = record;
    this.emit(`${player.name} hat eine Antwort abgegeben (verbindlich).`);
    return record;
  }

  // ------------------------------------------------------------------- Joker

  /**
   * Aktiviert einen Joker. Der Moderator bestaetigt die Aktivierung. Jeder
   * Joker steht pro Team genau einmal zur Verfuegung und wird danach dauerhaft
   * verbraucht.
   */
  async activateJoker(type: JokerType, team: TeamId = this.state.activeTeam): Promise<void> {
    if (this.state.phase !== 'question' && this.state.phase !== 'joker') {
      throw new GameRuleError('no_question', 'Joker koennen nur waehrend einer Frage eingesetzt werden.');
    }
    if (this.state.currentQuestion === null) throw new GameRuleError('no_question', 'Es ist keine Frage aktiv.');
    const teamState = this.state.teams[team];
    if (teamState.jokers[type] === 'used') {
      throw new GameRuleError('joker_used', `${JOKER_LABELS[type]} wurde von ${teamState.name} bereits verbraucht.`);
    }
    if (this.state.joker.active !== null) {
      throw new GameRuleError('joker_active', 'Es ist bereits ein Joker aktiv. Bitte zuerst beenden.');
    }
    // Antwortzeit waehrend eines Jokers anhalten.
    if (this.state.countdown.state === 'running') this.pauseCountdown();

    teamState.jokers[type] = 'used';
    this.state.phase = 'joker';
    this.state.joker = {
      active: type,
      forTeam: team,
      hiddenOptions: [],
      aiHint: null,
      votes: new Map(),
    };

    if (type === 'fifty') {
      this.state.joker.hiddenOptions = this.pickFiftyOptions(this.state.currentQuestion);
    } else if (type === 'ai') {
      const hint = await this.hintProvider(this.state.currentQuestion);
      this.state.joker.aiHint = hint;
    } else {
      this.state.joker.votes = new Map();
    }
    this.emit(`${JOKER_LABELS[type]} fuer ${teamState.name} aktiviert.`);
  }

  /** Zwei falsche Optionen bestimmen - die richtige bleibt immer sichtbar. */
  private pickFiftyOptions(question: QuestionRecord): number[] {
    const wrong = [0, 1, 2, 3].filter((i) => i !== question.correctIndex);
    const shuffled = [...wrong].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, 2).sort((a, b) => a - b);
  }

  closeJoker(): void {
    if (this.state.joker.active === null) throw new GameRuleError('no_joker', 'Es ist kein Joker aktiv.');
    const label = JOKER_LABELS[this.state.joker.active];
    this.state.joker = { active: null, forTeam: null, hiddenOptions: [], aiHint: null, votes: new Map() };
    this.state.phase = 'question';
    this.emit(`${label} beendet.`);
  }

  /** Publikumsabstimmung. Eine Stimme pro Teilnehmer und Abstimmung. */
  castAudienceVote(voterToken: string, optionIndex: number): void {
    if (this.state.joker.active !== 'audience') {
      throw new GameRuleError('no_poll', 'Aktuell laeuft keine Publikumsabstimmung.');
    }
    if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= OPTION_COUNT) {
      throw new GameRuleError('invalid_option', 'Ungueltige Antwortoption.');
    }
    if (this.state.joker.votes.has(voterToken)) {
      throw new GameRuleError('already_voted', 'Es wurde bereits abgestimmt.');
    }
    this.state.joker.votes.set(voterToken, optionIndex);
    this.emit('Publikumsstimme abgegeben.');
  }

  pollCounts(): number[] {
    const counts = [0, 0, 0, 0];
    for (const vote of this.state.joker.votes.values()) counts[vote] = (counts[vote] ?? 0) + 1;
    return counts;
  }

  // ---------------------------------------------------------------- Aufloesung

  /**
   * Loest die Frage auf. Dies ist der einzige Weg, auf dem die richtige Antwort
   * freigegeben und der Punktestand veraendert wird.
   */
  reveal(): RevealState {
    if (this.state.phase !== 'question' && this.state.phase !== 'joker') {
      throw new GameRuleError('nothing_to_reveal', 'Es gibt keine laufende Frage zum Aufloesen.');
    }
    const question = this.state.currentQuestion;
    if (!question) throw new GameRuleError('no_question', 'Es ist keine Frage aktiv.');

    this.stopTimer();
    const teamId = this.state.activeTeam;
    const team = this.state.teams[teamId];
    const answer = this.state.answers[teamId];
    const levelBefore = team.level;

    let outcome: AnswerOutcome;
    if (!answer) outcome = 'timeout';
    else outcome = answer.optionIndex === question.correctIndex ? 'correct' : 'wrong';

    let progress;
    if (outcome === 'correct') {
      progress = applyCorrectAnswer(team.level, team.safetyLevels);
    } else {
      progress = applyWrongAnswer(team.level, team.safetyLevels);
    }
    team.level = progress.level;
    team.floor = progress.floor;

    const reveal: RevealState = {
      questionId: question.id,
      outcome,
      correctIndex: question.correctIndex,
      chosenIndex: answer?.optionIndex ?? null,
      explanation: question.explanation,
      legalBasis: question.legalBasis,
      legalStatus: question.legalStatus,
      sourceNote: question.sourceNote,
      levelBefore,
      levelAfter: progress.level,
    };
    this.state.reveal = reveal;
    this.state.countdown = { state: 'idle', endsAt: null, remainingMs: null };
    this.state.phase = 'revealed';

    if (outcome === 'correct' && progress.completed && !team.completed) {
      team.completed = true;
      this.issueCertificate(answer?.playerId ?? null, teamId);
      this.emit(`${team.name} hat Stufe ${LADDER_MAX_LEVEL} erreicht - Challenge bestanden.`);
    } else if (outcome === 'correct') {
      this.emit(`Richtig: ${team.name} steigt auf Stufe ${progress.level}.`);
    } else if (outcome === 'wrong') {
      this.emit(`Falsch: ${team.name} faellt zurueck auf Sicherheitsstufe ${progress.level}.`);
    } else {
      this.emit(`Keine Antwort: ${team.name} faellt zurueck auf Sicherheitsstufe ${progress.level}.`);
    }
    this.notify();
    return reveal;
  }

  private issueCertificate(playerId: string | null, team: TeamId): CertificateRecord | null {
    const player = playerId ? this.state.players.get(playerId) : null;
    if (!player) return null;
    const record: CertificateRecord = {
      id: randomId(),
      playerName: player.name,
      team,
      level: LADDER_MAX_LEVEL,
      issuedAt: new Date(this.clock.now()).toISOString(),
    };
    this.state.certificates.push(record);
    return record;
  }

  // ------------------------------------------------------------- Rundenwechsel

  /** Wechselt das aktive Team. Nur nach Aufloesung oder im Ruhezustand moeglich. */
  nextTeam(): void {
    if (this.state.phase === 'question' || this.state.phase === 'joker') {
      throw new GameRuleError('question_running', 'Bitte zuerst die laufende Frage aufloesen.');
    }
    this.stopTimer();
    this.state.activeTeam = this.state.activeTeam === 'A' ? 'B' : 'A';
    this.state.currentQuestion = null;
    this.state.reveal = null;
    this.state.answers = { A: null, B: null };
    this.state.countdown = { state: 'idle', endsAt: null, remainingMs: null };
    this.state.joker = { active: null, forTeam: null, hiddenOptions: [], aiHint: null, votes: new Map() };
    this.state.phase = 'idle';
    this.emit(`${this.state.teams[this.state.activeTeam].name} ist am Zug.`);
  }

  setActiveTeam(team: TeamId): void {
    if (this.state.phase === 'question' || this.state.phase === 'joker') {
      throw new GameRuleError('question_running', 'Teamwechsel waehrend einer Frage nicht moeglich.');
    }
    this.state.activeTeam = team;
    this.state.reveal = null;
    this.emit(`${this.state.teams[team].name} ist am Zug.`);
  }

  /** Sicherheitsstufen aendern (Standard: 5 und 10). */
  setSafetyLevels(team: TeamId, levels: number[]): void {
    const normalized = normalizeSafetyLevels(levels);
    const teamState = this.state.teams[team];
    teamState.safetyLevels = normalized;
    // Rueckfallgrenze neu berechnen, ohne den Fortschritt zu veraendern.
    teamState.floor = safetyFloorFor(teamState.level, normalized);
    this.emit(`Sicherheitsstufen von ${teamState.name}: ${normalized.join(', ') || 'keine'}.`);
  }

  /** Spielstand vollstaendig zuruecksetzen. Ausgestellte Zertifikate bleiben erhalten. */
  resetGame(): void {
    this.stopTimer();
    this.state.teams = { A: createTeam('A'), B: createTeam('B') };
    for (const team of TEAM_IDS) {
      this.state.teams[team].name = team === 'A' ? 'Team A' : 'Team B';
      this.refreshWheel(team);
    }
    this.state.phase = 'idle';
    this.state.activeTeam = 'A';
    this.state.currentQuestion = null;
    this.state.drawnByTeam = { A: null, B: null };
    this.state.answers = { A: null, B: null };
    this.state.countdown = { state: 'idle', endsAt: null, remainingMs: null };
    this.state.joker = { active: null, forTeam: null, hiddenOptions: [], aiHint: null, votes: new Map() };
    this.state.reveal = null;
    this.emit('Spiel zurueckgesetzt.');
  }

  endGame(): void {
    this.stopTimer();
    this.state.phase = 'ended';
    this.emit('Show beendet.');
  }

  dispose(): void {
    this.stopTimer();
    this.listeners.clear();
  }

  // ------------------------------------------------------------------ Sichten

  countdownView() {
    return {
      state: this.state.countdown.state,
      endsAt: this.state.countdown.endsAt,
      remainingMs: this.state.countdown.remainingMs,
    };
  }

  teamView(team: TeamId) {
    const t = this.state.teams[team];
    return {
      id: t.id,
      name: t.name,
      level: t.level,
      floor: t.floor,
      safetyLevels: [...t.safetyLevels],
      completed: t.completed,
      jokers: { ...t.jokers },
    };
  }

  wheelView(team: TeamId) {
    const ids = new Set(this.teamPlayers(team).map((p) => p.id));
    const players = this.teamPlayers(team).map((p) => ({
      id: p.id,
      name: p.name,
      inWheel: this.state.teams[team].wheel.remaining.includes(p.id) && ids.has(p.id),
    }));
    const lastDrawn = this.state.teams[team].wheel.lastDrawn;
    return {
      players,
      lastDrawn,
      lastDrawnName: lastDrawn ? this.state.players.get(lastDrawn)?.name ?? null : null,
      roundsCompleted: this.state.teams[team].wheel.roundsCompleted,
    };
  }

  /** Antwortdaten fuer die Moderatorensicht (mit Namen, ohne Geheimnisprobleme). */
  answerView(team: TeamId) {
    const answer = this.state.answers[team];
    if (!answer) return null;
    return {
      playerId: answer.playerId,
      playerName: answer.playerName,
      optionIndex: answer.optionIndex,
      at: answer.at,
    };
  }

  isDrawn(playerId: string, team: TeamId): boolean {
    return this.state.drawnByTeam[team] === playerId;
  }
}
