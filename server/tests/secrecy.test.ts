import { describe, expect, it } from 'vitest';
import { GameEngine } from '../src/engine/game.js';
import { audienceView, candidateView, moderatorView } from '../src/engine/projections.js';
import { FakeClock, makeQuestion } from './helpers.js';

function setup() {
  const clock = new FakeClock();
  const engine = new GameEngine({ code: 'SECRET', name: 'Geheimshow', clock, hintProvider: async () => 'Hinweis' });
  const alice = engine.addPlayer('Alice', 'A');
  const carol = engine.addPlayer('Carol', 'B');
  return { engine, alice, carol };
}

/** Sucht rekursiv nach dem Schluessel "correctIndex". */
function containsCorrectIndex(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsCorrectIndex);
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).some(
      ([key, nested]) => key === 'correctIndex' || containsCorrectIndex(nested),
    );
  }
  return false;
}

describe('Geheimhaltung: richtige Antwort vor der Freigabe', () => {
  it('enthaelt in der Kandidatensicht vor der Freigabe keinen correctIndex', () => {
    const { engine, alice } = setup();
    engine.spinWheel('A', () => 0);
    engine.startQuestion(makeQuestion({ correctIndex: 3 }));
    const view = candidateView(engine, alice);
    expect(view.question).not.toBeNull();
    expect(containsCorrectIndex(view)).toBe(false);
    expect(view.reveal).toBeNull();
    // Die Optionstexte sind sichtbar, die Zuordnung zur richtigen Antwort nicht.
    expect(view.question?.options).toHaveLength(4);
    expect(Object.keys(view.question ?? {})).not.toContain('correctIndex');
  });

  it('enthaelt in der Publikumssicht vor der Freigabe keinen correctIndex', () => {
    const { engine } = setup();
    engine.startQuestion(makeQuestion({ correctIndex: 0 }));
    const view = audienceView(engine, 'voter-1');
    expect(containsCorrectIndex(view)).toBe(false);
    expect(view.reveal).toBeNull();
  });

  it('enthaelt in der Moderatorensicht jederzeit den correctIndex', () => {
    const { engine } = setup();
    engine.startQuestion(makeQuestion({ correctIndex: 2 }));
    const view = moderatorView(engine);
    expect(view.currentQuestion?.correctIndex).toBe(2);
  });

  it('gibt die richtige Antwort erst nach der Freigabe an Kandidaten weiter', () => {
    const { engine, alice } = setup();
    engine.spinWheel('A', () => 0);
    engine.startQuestion(makeQuestion({ correctIndex: 2 }));
    engine.submitAnswer(alice.id, 2);
    expect(containsCorrectIndex(candidateView(engine, alice))).toBe(false);
    engine.reveal();
    const after = candidateView(engine, alice);
    expect(after.reveal?.correctIndex).toBe(2);
  });

  it('liefert die Frage nicht an das nicht aktive Team', () => {
    const { engine, carol } = setup();
    engine.startQuestion(makeQuestion());
    // Team A ist aktiv; Carol spielt in Team B.
    const view = candidateView(engine, carol);
    expect(view.question).toBeNull();
    expect(view.isActive).toBe(false);
  });

  it('zeigt in der Publikumssicht den Fragetext, aber keine Loesung', () => {
    const { engine } = setup();
    engine.startQuestion(makeQuestion({ text: 'Sichtbarer Fragetext?' }));
    const view = audienceView(engine, null);
    expect(view.question?.text).toBe('Sichtbarer Fragetext?');
    expect(containsCorrectIndex(view)).toBe(false);
  });
});

describe('Geheimhaltung: Antwortzuordnung', () => {
  it('zeigt die abgegebene Antwort dem Kandidaten, aber nicht die Auswertung', () => {
    const { engine, alice } = setup();
    engine.spinWheel('A', () => 0);
    engine.startQuestion(makeQuestion({ correctIndex: 1 }));
    engine.submitAnswer(alice.id, 3);
    const view = candidateView(engine, alice);
    expect(view.yourAnswer).toBe(3);
    expect(view.reveal).toBeNull();
  });

  it('gibt die Antwort eines anderen Kandidaten nicht an Dritte weiter', () => {
    const { engine, alice, carol } = setup();
    engine.spinWheel('A', () => 0);
    engine.startQuestion(makeQuestion({ correctIndex: 1 }));
    engine.submitAnswer(alice.id, 1);
    // Carol ist in Team B und sieht keine Frage und keine Antwort von Alice.
    const view = candidateView(engine, carol);
    expect(view.question).toBeNull();
    expect(view.yourAnswer).toBeNull();
  });
});
