import { describe, expect, it } from 'vitest';
import { GameEngine } from '../src/engine/game.js';
import { FakeClock, makeQuestion } from './helpers.js';

function setup(hint = 'Fachlicher Hinweis ohne Loesung') {
  const clock = new FakeClock();
  const engine = new GameEngine({ code: 'JOKER1', name: 'Jokershow', clock, hintProvider: async () => hint });
  const alice = engine.addPlayer('Alice', 'A');
  engine.addPlayer('Bob', 'A');
  const carol = engine.addPlayer('Carol', 'B');
  return { engine, clock, alice, carol };
}

describe('Joker: Verbrauch pro Team', () => {
  it('verbraucht jeden Joker dauerhaft nach dem Einsatz', async () => {
    const { engine } = setup();
    engine.startQuestion(makeQuestion());
    await engine.activateJoker('fifty', 'A');
    engine.closeJoker();
    expect(engine.state.teams.A.jokers.fifty).toBe('used');
    await expect(engine.activateJoker('fifty', 'A')).rejects.toThrow(/bereits verbraucht/i);
  });

  it('verwaltet die Joker pro Team getrennt', async () => {
    const { engine } = setup();
    engine.startQuestion(makeQuestion());
    await engine.activateJoker('fifty', 'A');
    engine.closeJoker();
    expect(engine.state.teams.A.jokers.fifty).toBe('used');
    expect(engine.state.teams.B.jokers.fifty).toBe('available');
  });

  it('erlaubt nur einen aktiven Joker gleichzeitig', async () => {
    const { engine } = setup();
    engine.startQuestion(makeQuestion());
    await engine.activateJoker('fifty', 'A');
    await expect(engine.activateJoker('ai', 'A')).rejects.toThrow(/bereits ein Joker aktiv/i);
  });

  it('verbietet Joker ohne laufende Frage', async () => {
    const { engine } = setup();
    await expect(engine.activateJoker('fifty', 'A')).rejects.toThrow(/nur waehrend einer Frage/i);
  });
});

describe('Joker: 50:50', () => {
  it('blendet genau zwei falsche Optionen aus und behaelt die richtige', async () => {
    const { engine } = setup();
    engine.startQuestion(makeQuestion({ correctIndex: 1 }));
    await engine.activateJoker('fifty', 'A');
    const hidden = engine.state.joker.hiddenOptions;
    expect(hidden).toHaveLength(2);
    expect(hidden).not.toContain(1);
    for (const index of hidden) expect(index).not.toBe(1);
  });
});

describe('Joker: KI-Joker', () => {
  it('liefert einen Hinweis, ohne die Loesung zu nennen', async () => {
    const { engine } = setup('Pruefe die einschlaegige Norm, ohne die Antwort zu nennen.');
    const question = makeQuestion({ correctIndex: 0, options: ['Richtige Antwort', 'B', 'C', 'D'] });
    engine.startQuestion(question);
    await engine.activateJoker('ai', 'A');
    const hint = engine.state.joker.aiHint ?? '';
    expect(hint.length).toBeGreaterThan(0);
    expect(hint.toLowerCase()).not.toContain('richtige antwort');
  });
});

describe('Joker: Publikumsjoker', () => {
  it('zaehlt je Teilnehmer genau eine Stimme', () => {
    const { engine } = setup();
    engine.startQuestion(makeQuestion());
    return engine.activateJoker('audience', 'A').then(() => {
      engine.castAudienceVote('voter-1', 2);
      engine.castAudienceVote('voter-2', 2);
      engine.castAudienceVote('voter-3', 0);
      expect(engine.pollCounts()).toEqual([1, 0, 2, 0]);
      expect(() => engine.castAudienceVote('voter-1', 1)).toThrow(/bereits abgestimmt/i);
    });
  });

  it('verbietet Abstimmungen ausserhalb einer laufenden Abstimmung', () => {
    const { engine } = setup();
    engine.startQuestion(makeQuestion());
    expect(() => engine.castAudienceVote('voter-1', 1)).toThrow(/keine Publikumsabstimmung/i);
  });

  it('verbietet ungueltige Optionen', () => {
    const { engine } = setup();
    engine.startQuestion(makeQuestion());
    return engine.activateJoker('audience', 'A').then(() => {
      expect(() => engine.castAudienceVote('voter-1', 9)).toThrow(/Ungueltige Antwortoption/i);
    });
  });
});

describe('Joker: Beenden', () => {
  it('setzt die Phase nach dem Joker zurueck auf die Frage', async () => {
    const { engine } = setup();
    engine.startQuestion(makeQuestion());
    await engine.activateJoker('fifty', 'A');
    expect(engine.state.phase).toBe('joker');
    engine.closeJoker();
    expect(engine.state.phase).toBe('question');
    expect(engine.state.joker.active).toBeNull();
  });

  it('verbietet das Beenden ohne aktiven Joker', () => {
    const { engine } = setup();
    engine.startQuestion(makeQuestion());
    expect(() => engine.closeJoker()).toThrow(/kein Joker aktiv/i);
  });
});
