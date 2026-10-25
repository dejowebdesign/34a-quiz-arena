/**
 * Fachliche Konstanten und Grundtypen der 34A Quiz Arena.
 * Reine Typen/Logik ohne Laufzeitabhaengigkeiten - von Server und Client gemeinsam genutzt.
 */

export type TeamId = 'A' | 'B';
export const TEAM_IDS: readonly TeamId[] = ['A', 'B'];

export type Role = 'moderator' | 'candidate' | 'audience';

/** Themengebiete der Sachkundepruefung § 34a GewO. */
export type Topic =
  | 'oeffentliches_recht_gewerberecht'
  | 'straf_verfahrensrecht'
  | 'bgb'
  | 'unfallverhuetung'
  | 'umgang_mit_menschen'
  | 'sicherheitstechnik';

export const TOPICS: readonly Topic[] = [
  'oeffentliches_recht_gewerberecht',
  'straf_verfahrensrecht',
  'bgb',
  'unfallverhuetung',
  'umgang_mit_menschen',
  'sicherheitstechnik',
];

export const TOPIC_LABELS: Record<Topic, string> = {
  oeffentliches_recht_gewerberecht: 'Oeffentliches Recht / Gewerberecht',
  straf_verfahrensrecht: 'Straf- und Verfahrensrecht',
  bgb: 'Buergerliches Gesetzbuch (BGB)',
  unfallverhuetung: 'Unfallverhuetung',
  umgang_mit_menschen: 'Umgang mit Menschen',
  sicherheitstechnik: 'Sicherheitstechnik',
};

export type Difficulty = 'leicht' | 'mittel' | 'schwer';
export const DIFFICULTIES: readonly Difficulty[] = ['leicht', 'mittel', 'schwer'];
export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  leicht: 'Leicht',
  mittel: 'Mittel',
  schwer: 'Schwer',
};

/** Redaktioneller Pruefstatus einer Frage. */
export type QuestionStatus = 'draft' | 'review' | 'approved' | 'archived';
export const QUESTION_STATUS_LABELS: Record<QuestionStatus, string> = {
  draft: 'Entwurf',
  review: 'In Pruefung',
  approved: 'Freigegeben',
  archived: 'Archiviert',
};

/**
 * Pruefstatus der Rechtsgrundlage. Erzwingt, dass rechtliche Angaben als
 * "zu pruefen" gekennzeichnet werden koennen, statt Aktualitaet zu behaupten.
 */
export type LegalStatus = 'unverified' | 'verified' | 'needs_review';
export const LEGAL_STATUS_LABELS: Record<LegalStatus, string> = {
  unverified: 'Rechtsstand nicht geprueft',
  verified: 'Rechtsstand geprueft',
  needs_review: 'Pruefung erforderlich',
};

export type JokerType = 'ai' | 'audience' | 'fifty';
export const JOKER_TYPES: readonly JokerType[] = ['ai', 'audience', 'fifty'];
export const JOKER_LABELS: Record<JokerType, string> = {
  ai: 'KI-Joker',
  audience: 'Publikumsjoker',
  fifty: '50:50-Joker',
};

export type JokerStatus = 'available' | 'used';

/** Spielphasen einer Frage-Runde. */
export type Phase = 'idle' | 'question' | 'joker' | 'revealed' | 'ended';

export type CountdownState = 'idle' | 'running' | 'paused' | 'expired';

export type AnswerOutcome = 'correct' | 'wrong' | 'timeout';

export interface AnswerOption {
  text: string;
}

export interface QuestionRecord {
  id: number;
  topic: Topic;
  difficulty: Difficulty;
  text: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  legalBasis: string | null;
  legalStatus: LegalStatus;
  sourceNote: string | null;
  status: QuestionStatus;
  createdAt: string;
  updatedAt: string;
}

/** Anzahl der Stufen auf der Gewinnleiter. */
export const LADDER_MAX_LEVEL = 15;
/** Standardmaessige Sicherheitsstufen. */
export const DEFAULT_SAFETY_LEVELS: readonly number[] = [5, 10];
/** Dauer der letzten zehn Sekunden in Millisekunden. */
export const COUNTDOWN_MS = 10_000;
/** Feste Anzahl Antwortoptionen pro Frage. */
export const OPTION_COUNT = 4;
/**
 * Mindestanzahl freigegebener Fragen, damit eine Show gestartet werden darf.
 * Die Leiter hat 15 Stufen; ohne mindestens 15 spielbare Fragen waere ein
 * vollstaendiger Durchgang nicht moeglich.
 */
export const MIN_APPROVED_QUESTIONS = LADDER_MAX_LEVEL;

export const TEAM_LABELS: Record<TeamId, string> = { A: 'Team A', B: 'Team B' };
