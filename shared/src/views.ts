import type {
  AnswerOutcome,
  CountdownState,
  Difficulty,
  JokerStatus,
  JokerType,
  LegalStatus,
  Phase,
  QuestionStatus,
  Role,
  TeamId,
  Topic,
} from './domain.js';

/**
 * Rollenabhaengige Sichten. Der Server erzeugt pro Verbindung genau eine dieser
 * Sichten. Die richtige Antwort (correctIndex) existiert ausschliesslich in der
 * Moderatorensicht, solange die Phase nicht 'revealed' ist.
 */

export interface PublicQuestion {
  id: number;
  topic: Topic;
  difficulty: Difficulty;
  text: string;
  options: string[];
}

export interface FullQuestion extends PublicQuestion {
  correctIndex: number;
  explanation: string;
  legalBasis: string | null;
  legalStatus: LegalStatus;
  sourceNote: string | null;
  status: QuestionStatus;
}

export interface TeamView {
  id: TeamId;
  name: string;
  level: number;
  floor: number;
  safetyLevels: number[];
  completed: boolean;
  jokers: Record<JokerType, JokerStatus>;
}

export interface PlayerView {
  id: string;
  name: string;
  inWheel: boolean;
}

export interface WheelView {
  players: PlayerView[];
  lastDrawn: string | null;
  lastDrawnName: string | null;
  roundsCompleted: number;
}

export interface CountdownView {
  state: CountdownState;
  /** Serverzeit in ms, zu der der Countdown endet (nur bei 'running'). */
  endsAt: number | null;
  /** Verbleibende ms bei 'paused', sonst null. */
  remainingMs: number | null;
}

export interface AnswerView {
  playerId: string;
  playerName: string;
  optionIndex: number;
  at: number;
}

export interface LogEntryView {
  at: number;
  text: string;
}

export interface RevealView {
  questionId: number;
  outcome: AnswerOutcome;
  correctIndex: number;
  chosenIndex: number | null;
  explanation: string;
  legalBasis: string | null;
  legalStatus: LegalStatus;
  sourceNote: string | null;
  levelBefore: number;
  levelAfter: number;
}

export interface CertificateView {
  id: string;
  playerName: string;
  team: TeamId;
  level: number;
  issuedAt: string;
  disclaimer: string;
}

export interface ModeratorView {
  role: 'moderator';
  sessionCode: string;
  sessionName: string;
  phase: Phase;
  activeTeam: TeamId;
  teams: Record<TeamId, TeamView>;
  currentQuestion: FullQuestion | null;
  answers: Record<TeamId, AnswerView | null>;
  countdown: CountdownView;
  wheels: Record<TeamId, WheelView>;
  joker: {
    active: JokerType | null;
    forTeam: TeamId | null;
    /** Optionen, die durch 50:50 ausgeblendet sind. */
    hiddenOptions: number[];
    /** KI-Hinweis, falls aktiviert. */
    aiHint: string | null;
    poll: number[];
    pollTotal: number;
  };
  reveal: RevealView | null;
  log: LogEntryView[];
  certificates: CertificateView[];
  /** Selbstbeitritt fuer Kandidaten freigegeben? */
  openJoin: boolean;
  /** Serverzeit, damit Clients Drift ausgleichen koennen. */
  serverNow: number;
}

export interface CandidateView {
  role: 'candidate';
  sessionCode: string;
  playerId: string;
  playerName: string;
  team: TeamId;
  phase: Phase;
  activeTeam: TeamId;
  /** true, wenn der eigene Spieler im aktuellen Durchgang gezogen wurde. */
  isDrawn: boolean;
  isActive: boolean;
  question: PublicQuestion | null;
  hiddenOptions: number[];
  yourAnswer: number | null;
  countdown: CountdownView;
  /** Fortschritt des eigenen Teams (Leiter, Sicherheitsstufen, Joker). */
  teamState: TeamView;
  /** Erst nach Freigabe durch den Moderator gefuellt. */
  reveal: RevealView | null;
  certificate: CertificateView | null;
  serverNow: number;
}

export interface AudienceView {
  role: 'audience';
  sessionCode: string;
  phase: Phase;
  activeTeam: TeamId;
  teams: Record<TeamId, TeamView>;
  question: PublicQuestion | null;
  countdown: CountdownView;
  wheels: Record<TeamId, WheelView>;
  joker: {
    active: JokerType | null;
    forTeam: TeamId | null;
    hiddenOptions: number[];
    poll: number[];
    pollTotal: number;
    yourVote: number | null;
  };
  reveal: RevealView | null;
  serverNow: number;
}

export type SessionView = ModeratorView | CandidateView | AudienceView;

export interface ServerErrorPayload {
  code: string;
  message: string;
}

export interface HandshakeOkPayload {
  role: Role;
  sessionCode: string;
}

/** Socket.IO Ereignisnamen. */
export const S2C = {
  view: 'session:view',
  error: 'session:error',
  joined: 'session:joined',
} as const;

export const C2S = {
  moderatorCreate: 'moderator:create',
  moderatorJoin: 'moderator:join',
  candidateJoin: 'candidate:join',
  audienceJoin: 'audience:join',
  answer: 'candidate:answer',
  audienceVote: 'audience:vote',
  spinWheel: 'moderator:spinWheel',
  startQuestion: 'moderator:startQuestion',
  clearQuestion: 'moderator:clearQuestion',
  startCountdown: 'moderator:startCountdown',
  pauseCountdown: 'moderator:pauseCountdown',
  resumeCountdown: 'moderator:resumeCountdown',
  activateJoker: 'moderator:activateJoker',
  closeJoker: 'moderator:closeJoker',
  reveal: 'moderator:reveal',
  nextTeam: 'moderator:nextTeam',
  setSafetyLevels: 'moderator:setSafetyLevels',
  setOpenJoin: 'moderator:setOpenJoin',
  resetGame: 'moderator:resetGame',
} as const;
