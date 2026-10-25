import { describe, expect, it } from 'vitest';
import { GameEngine, GameRuleError } from '../src/engine/game.js';
import { drawnPlayer, FakeClock, makeQuestion } from './helpers.js';

function setup() {
  const clock = new FakeClock();
  const engine = new GameEngine({ code: 'TEST01', name: 'Testshow', clock, hintProvider: async () => 'Hinweis' , approvedQuestionCount: () => 99 });
  const alice = engine.addPlayer('Alice', 'A');
  const bob = engine.addPlayer('Bob', 'A');
  const carol = engine.addPlayer('Carol', 'B');
  engine.startGame();
  return { engine, clock, alice, bob, carol };
}

describe('Spielregeln: Grundlagen', () => {
  it('startet mit zwei Teams auf Stufe 0 und drei verfuegbaren Jokern', () => {
    const { engine } = setup();
    expect(engine.state.teams.A.level).toBe(0);
    expect(engine.state.teams.B.level).toBe(0);
    expect(engine.state.teams.A.jokers).toEqual({ ai: 'available', audience: 'available', fifty: 'available' });
    expect(engine.state.activeTeam).toBe('A');
  });

  it('lehnt doppelte Spielernamen im selben Team ab', () => {
    const { engine } = setup();
    expect(() => engine.addPlayer('Alice', 'A')).toThrow(GameRuleError);
    expect(() => engine.addPlayer('Alice', 'B')).not.toThrow();
  });

  it('startet nur freigegebene Fragen', () => {
    const { engine } = setup();
    expect(() => engine.startQuestion(makeQuestion({ status: 'draft' }))).toThrow(/freigegeben/i);
    expect(() => engine.startQuestion(makeQuestion())).not.toThrow();
    expect(engine.state.phase).toBe('question');
  });
});

describe('Spielregeln: Antwortabgabe', () => {
  it('erlaubt nur dem gezogenen Kandidaten des aktiven Teams zu antworten', () => {
    const { engine, alice, bob } = setup();
    // Das Rad wird vor der Frage gedreht; waehrend der Frage ist es gesperrt.
    expect(() => engine.spinWheel('A', () => 0)).not.toThrow();
    engine.startQuestion(makeQuestion());
    // Bob ist im Team A, aber nicht gezogen.
    expect(() => engine.submitAnswer(bob.id, 2)).toThrow(/gezogene/i);
    expect(() => engine.submitAnswer(alice.id, 2)).not.toThrow();
  });

  it('sperrt das Gluecksrad waehrend einer laufenden Frage (Manipulationsschutz)', () => {
    const { engine } = setup();
    engine.spinWheel('A', () => 0);
    engine.startQuestion(makeQuestion());
    expect(() => engine.spinWheel('A', () => 0)).toThrow(/laufenden Frage/i);
  });

  it('verhindert doppelte Antworten', () => {
    const { engine, alice } = setup();
    engine.spinWheel('A', () => 0);
    engine.startQuestion(makeQuestion());
    engine.submitAnswer(alice.id, 2);
    expect(() => engine.submitAnswer(alice.id, 1)).toThrow(/bereits eine Antwort/i);
  });

  it('verhindert Antworten aus dem nicht aktiven Team', () => {
    const { engine, carol } = setup();
    engine.spinWheel('A', () => 0);
    engine.startQuestion(makeQuestion());
    expect(() => engine.submitAnswer(carol.id, 2)).toThrow(/nicht am Zug/i);
  });

  it('verhindert Antworten, wenn kein Kandidat gezogen wurde', () => {
    const { engine, alice } = setup();
    engine.startQuestion(makeQuestion());
    // Kein Rad gedreht, also kein gezogener Kandidat.
    expect(() => engine.submitAnswer(alice.id, 0)).toThrow(/gezogene/i);
  });

  it('verhindert ungueltige Optionen', () => {
    const { engine, alice } = setup();
    engine.spinWheel('A', () => 0);
    engine.startQuestion(makeQuestion());
    expect(() => engine.submitAnswer(alice.id, 4)).toThrow(/Ungueltige Antwortoption/i);
    expect(() => engine.submitAnswer(alice.id, -1)).toThrow(/Ungueltige Antwortoption/i);
  });
});

describe('Spielregeln: Aufloesung', () => {
  it('erhoeht bei richtiger Antwort den Fortschritt um eine Stufe', () => {
    const { engine, alice } = setup();
    engine.spinWheel('A', () => 0);
    engine.startQuestion(makeQuestion({ correctIndex: 2 }));
    engine.submitAnswer(alice.id, 2);
    const reveal = engine.reveal();
    expect(reveal.outcome).toBe('correct');
    expect(reveal.levelBefore).toBe(0);
    expect(reveal.levelAfter).toBe(1);
    expect(engine.state.teams.A.level).toBe(1);
  });

  it('faellt bei falscher Antwort auf die Sicherheitsstufe zurueck', () => {
    const { engine, alice } = setup();
    // Fortschritt bis Stufe 7 aufbauen.
    for (let i = 0; i < 7; i += 1) {
      engine.spinWheel('A');
      engine.startQuestion(makeQuestion({ id: 100 + i, correctIndex: 2 }));
      engine.submitAnswer(drawnPlayer(engine)!.id, 2);
      engine.reveal();
      engine.nextTeam();
      engine.setActiveTeam('A');
    }
    expect(engine.state.teams.A.level).toBe(7);
    engine.spinWheel('A');
    engine.startQuestion(makeQuestion({ id: 200, correctIndex: 2 }));
    engine.submitAnswer(drawnPlayer(engine)!.id, 0);
    const reveal = engine.reveal();
    expect(reveal.outcome).toBe('wrong');
    expect(engine.state.teams.A.level).toBe(5);
  });

  it('behandelt eine unbeantwortete Frage als Rueckfall', () => {
    const { engine, alice } = setup();
    engine.spinWheel('A', () => 0);
    engine.startQuestion(makeQuestion());
    void alice;
    const reveal = engine.reveal();
    expect(reveal.outcome).toBe('timeout');
    expect(reveal.chosenIndex).toBeNull();
    expect(engine.state.teams.A.level).toBe(0);
  });

  it('stellt nach Stufe 15 ein Zertifikat aus', () => {
    const { engine, alice } = setup();
    for (let i = 0; i < 15; i += 1) {
      engine.spinWheel('A');
      engine.startQuestion(makeQuestion({ id: 300 + i, correctIndex: 1 }));
      engine.submitAnswer(drawnPlayer(engine)!.id, 1);
      engine.reveal();
      if (i < 14) {
        engine.nextTeam();
        engine.setActiveTeam('A');
      }
    }
    expect(engine.state.teams.A.level).toBe(15);
    expect(engine.state.teams.A.completed).toBe(true);
    expect(engine.state.certificates).toHaveLength(1);
    expect(['Alice', 'Bob']).toContain(engine.state.certificates[0]?.playerName);
    expect(engine.state.certificates[0]?.level).toBe(15);
  });

  it('erlaubt nach dem ersten Abschluss den Wechsel, damit das andere Team abschliessen kann', () => {
    const { engine } = setup();
    engine.state.teams.A.level = 15;
    engine.state.teams.A.completed = true;
    engine.nextTeam();
    expect(engine.state.activeTeam).toBe('B');
    expect(engine.state.teams.B.completed).toBe(false);
  });
});

describe('Spielregeln: Teamwechsel', () => {
  it('verbietet den Teamwechsel waehrend einer laufenden Frage', () => {
    const { engine } = setup();
    engine.startQuestion(makeQuestion());
    expect(() => engine.nextTeam()).toThrow(/laufende Frage/i);
  });

  it('wechselt nach der Aufloesung', () => {
    const { engine, alice } = setup();
    engine.spinWheel('A', () => 0);
    engine.startQuestion(makeQuestion());
    engine.submitAnswer(alice.id, 2);
    engine.reveal();
    engine.nextTeam();
    expect(engine.state.activeTeam).toBe('B');
  });
});

describe('Spielregeln: Zuruecksetzen', () => {
  it('setzt Leitern und Joker zurueck, behaelt aber Zertifikate', () => {
    const { engine } = setup();
    engine.state.teams.A.level = 8;
    engine.state.teams.A.jokers.ai = 'used';
    engine.state.certificates.push({
      id: 'c1',
      playerName: 'Alice',
      team: 'A',
      level: 15,
      issuedAt: new Date(0).toISOString(),
    });
    engine.resetGame();
    expect(engine.state.teams.A.level).toBe(0);
    expect(engine.state.teams.A.jokers.ai).toBe('available');
    expect(engine.state.certificates).toHaveLength(1);
  });
});
