import { describe, expect, it } from 'vitest';
import { GameEngine } from '../src/engine/game.js';
import { FakeClock, makeQuestion } from './helpers.js';

function setup() {
  const clock = new FakeClock();
  const engine = new GameEngine({ code: 'TIME01', name: 'Zeitshow', clock, hintProvider: async () => 'Hinweis' });
  const alice = engine.addPlayer('Alice', 'A');
  return { engine, clock, alice };
}

describe('Zeitsteuerung: Countdown', () => {
  it('startet nicht automatisch mit der Frage', () => {
    const { engine } = setup();
    engine.startQuestion(makeQuestion());
    expect(engine.state.countdown.state).toBe('idle');
    expect(engine.isAnswerable()).toBe(true);
  });

  it('startet nur auf ausdrueckliche Anweisung', () => {
    const { engine } = setup();
    engine.startQuestion(makeQuestion());
    engine.startCountdown();
    expect(engine.state.countdown.state).toBe('running');
    expect(engine.state.countdown.endsAt).not.toBeNull();
  });

  it('schliesst die Antwortphase nach Ablauf', () => {
    const { engine, clock, alice } = setup();
    engine.spinWheel('A', () => 0);
    engine.startQuestion(makeQuestion());
    engine.startCountdown();
    clock.advance(9_000);
    expect(engine.isAnswerable()).toBe(true);
    expect(() => engine.submitAnswer(alice.id, 1)).not.toThrow();
  });

  it('verhindert Antworten nach Ablauf', () => {
    const { engine, clock, alice } = setup();
    engine.spinWheel('A', () => 0);
    engine.startQuestion(makeQuestion());
    engine.startCountdown();
    clock.advance(10_000);
    expect(engine.state.countdown.state).toBe('expired');
    expect(engine.isAnswerable()).toBe(false);
    expect(() => engine.submitAnswer(alice.id, 1)).toThrow(/geschlossen/i);
  });

  it('erkennt einen abgelaufenen Countdown auch ohne Timer-Callback (Manipulationsschutz)', () => {
    const { engine, clock, alice } = setup();
    engine.spinWheel('A', () => 0);
    engine.startQuestion(makeQuestion());
    engine.startCountdown();
    // endsAt direkt in die Vergangenheit setzen, ohne den Timer auszuloesen.
    engine.state.countdown = { state: 'running', endsAt: clock.now() - 5_000, remainingMs: null };
    expect(engine.isAnswerable()).toBe(false);
    expect(() => engine.submitAnswer(alice.id, 1)).toThrow(/geschlossen/i);
  });

  it('verhindert einen doppelten Start des Countdowns', () => {
    const { engine } = setup();
    engine.startQuestion(makeQuestion());
    engine.startCountdown();
    expect(() => engine.startCountdown()).toThrow(/laeuft bereits/i);
  });

  it('erlaubt Pausieren und Fortsetzen mit korrekter Restzeit', () => {
    const { engine, clock, alice } = setup();
    engine.spinWheel('A', () => 0);
    engine.startQuestion(makeQuestion());
    engine.startCountdown();
    clock.advance(4_000);
    engine.pauseCountdown();
    expect(engine.state.countdown.state).toBe('paused');
    expect(engine.state.countdown.remainingMs).toBe(6_000);

    // Waehrend der Pause verstreicht beliebig viel Zeit ohne Ablauf.
    clock.advance(60_000);
    expect(engine.state.countdown.state).toBe('paused');
    expect(engine.isAnswerable()).toBe(true);

    engine.resumeCountdown();
    expect(engine.state.countdown.state).toBe('running');
    clock.advance(5_999);
    expect(engine.isAnswerable()).toBe(true);
    clock.advance(1);
    expect(engine.state.countdown.state).toBe('expired');
    expect(() => engine.submitAnswer(alice.id, 1)).toThrow();
  });

  it('verhindert Fortsetzen ohne Pause', () => {
    const { engine } = setup();
    engine.startQuestion(makeQuestion());
    engine.startCountdown();
    expect(() => engine.resumeCountdown()).toThrow(/nicht pausiert/i);
  });
});

describe('Zeitsteuerung: Zusammenspiel mit Jokern', () => {
  it('pausiert den Countdown bei Jokeraktivierung und setzt ihn danach fort', () => {
    const { engine, clock, alice } = setup();
    engine.spinWheel('A', () => 0);
    engine.startQuestion(makeQuestion());
    engine.startCountdown();
    clock.advance(3_000);

    return engine.activateJoker('fifty', 'A').then(() => {
      expect(engine.state.countdown.state).toBe('paused');
      expect(engine.state.countdown.remainingMs).toBe(7_000);
      clock.advance(30_000);
      expect(engine.state.countdown.state).toBe('paused');
      engine.closeJoker();
      engine.resumeCountdown();
      expect(engine.state.countdown.state).toBe('running');
      clock.advance(7_000);
      expect(engine.state.countdown.state).toBe('expired');
      expect(() => engine.submitAnswer(alice.id, 1)).toThrow(/geschlossen/i);
    });
  });
});
