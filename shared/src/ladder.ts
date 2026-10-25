import { DEFAULT_SAFETY_LEVELS, LADDER_MAX_LEVEL } from './domain.js';

/**
 * Reine Logik der Gewinnleiter. Keine Seiteneffekte, damit die Spielregeln
 * deterministisch getestet werden koennen.
 */

/** Sicherheitsstufen bereinigen: nur ganze Zahlen zwischen 1 und MAX-1, aufsteigend, ohne Duplikate. */
export function normalizeSafetyLevels(levels: readonly number[]): number[] {
  const seen = new Set<number>();
  for (const level of levels) {
    if (!Number.isInteger(level)) continue;
    if (level < 1 || level > LADDER_MAX_LEVEL - 1) continue;
    seen.add(level);
  }
  return [...seen].sort((a, b) => a - b);
}

/** Naechste Stufe nach einer richtigen Antwort (gedeckelt auf MAX). */
export function nextLevel(current: number): number {
  return Math.min(LADDER_MAX_LEVEL, current + 1);
}

/**
 * Zuletzt erreichte Sicherheitsstufe, die nicht oberhalb der aktuellen Stufe liegt.
 * Basis der Leiter ist 0 (kein Rueckfall unter den Start).
 */
export function safetyFloorFor(current: number, safetyLevels: readonly number[]): number {
  const normalized = normalizeSafetyLevels(safetyLevels);
  let floor = 0;
  for (const level of normalized) {
    if (level <= current) floor = level;
  }
  return floor;
}

export interface LadderProgress {
  level: number;
  floor: number;
  completed: boolean;
}

/** Richtige Antwort: eine Stufe aufsteigen. Stufe 15 bedeutet Challenge bestanden. */
export function applyCorrectAnswer(current: number, safetyLevels: readonly number[]): LadderProgress {
  const level = nextLevel(current);
  return { level, floor: safetyFloorFor(level, safetyLevels), completed: level >= LADDER_MAX_LEVEL };
}

/**
 * Falsche oder unbeantwortete Frage: Rueckfall auf die zuletzt erreichte
 * Sicherheitsstufe. Kein Ausscheiden - die Leiter wird nur zurueckgesetzt.
 */
export function applyWrongAnswer(current: number, safetyLevels: readonly number[]): LadderProgress {
  const level = safetyFloorFor(current, safetyLevels);
  return { level, floor: level, completed: level >= LADDER_MAX_LEVEL };
}

/** Stufenbezeichnungen 1..15 fuer die Anzeige der Gewinnleiter. */
export function ladderLevels(): number[] {
  return Array.from({ length: LADDER_MAX_LEVEL }, (_, index) => index + 1);
}

export const DEFAULT_LADDER_SAFETY_LEVELS = DEFAULT_SAFETY_LEVELS;
