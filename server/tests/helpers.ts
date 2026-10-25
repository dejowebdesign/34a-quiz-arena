import type { Clock } from '../src/engine/game.js';
import type { QuestionRecord } from '@quiz/shared';

/** Steuerbare Uhr fuer deterministische Zeit-Tests. */
export class FakeClock implements Clock {
  private current: number;
  private timers = new Map<number, { at: number; fn: () => void }>();
  private nextHandle = 1;

  constructor(start = 1_700_000_000_000) {
    this.current = start;
  }

  now(): number {
    return this.current;
  }

  setTimeout(fn: () => void, ms: number): unknown {
    const handle = this.nextHandle++;
    this.timers.set(handle, { at: this.current + ms, fn });
    return handle;
  }

  clearTimeout(handle: unknown): void {
    this.timers.delete(handle as number);
  }

  /** Zeit vorspulen und faellige Timer ausloesen. */
  advance(ms: number): void {
    const target = this.current + ms;
    let guard = 0;
    for (;;) {
      if (guard++ > 1000) throw new Error('Zu viele Timer');
      const due = [...this.timers.entries()].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at);
      const first = due[0];
      if (!first) break;
      const [handle, timer] = first;
      this.timers.delete(handle);
      this.current = timer.at;
      timer.fn();
    }
    this.current = target;
  }
}

import type { GameEngine } from '../src/engine/game.js';

/** Liefert den aktuell gezogenen Kandidaten des aktiven Teams. */
export function drawnPlayer(engine: GameEngine) {
  const team = engine.state.activeTeam;
  const id = engine.state.drawnByTeam[team];
  return id ? engine.state.players.get(id) : undefined;
}

export function makeQuestion(overrides: Partial<QuestionRecord> = {}): QuestionRecord {
  return {
    id: 1,
    topic: 'oeffentliches_recht_gewerberecht',
    difficulty: 'leicht',
    text: 'Wer benoetigt eine Erlaubnis nach § 34a GewO?',
    options: ['Antwort A', 'Antwort B', 'Antwort C', 'Antwort D'],
    correctIndex: 2,
    explanation: 'Erklaerung zur Frage.',
    legalBasis: '§ 34a GewO',
    legalStatus: 'unverified',
    sourceNote: null,
    status: 'approved',
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    ...overrides,
  };
}
