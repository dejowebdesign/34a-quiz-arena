import { describe, expect, it } from 'vitest';
import { createWheel, drawFromWheel, syncWheelPlayers } from '@quiz/shared';

const players = ['p1', 'p2', 'p3'];

/** Deterministischer Zufall: waehlt immer das erste verbliebene Element. */
const first = () => 0;

describe('Gluecksrad: Kandidatenauswahl', () => {
  it('waehlt jeden Spieler genau einmal, bevor sich das Rad neu auffuellt', () => {
    let wheel = createWheel(players);
    const drawn: string[] = [];
    for (let i = 0; i < players.length; i += 1) {
      const result = drawFromWheel(wheel, players, first);
      wheel = result.state;
      drawn.push(result.drawn);
    }
    expect(new Set(drawn).size).toBe(players.length);
    expect(drawn.sort()).toEqual([...players].sort());
  });

  it('fuellt das Rad nach dem vollstaendigen Durchgang wieder auf', () => {
    let wheel = createWheel(players);
    for (let i = 0; i < players.length; i += 1) {
      wheel = drawFromWheel(wheel, players, first).state;
    }
    expect([...wheel.remaining].sort()).toEqual([...players].sort());
    expect(wheel.roundsCompleted).toBe(1);
    expect(wheel.drawn).toHaveLength(0);
  });

  it('startet einen neuen Durchgang erst, wenn alle Spieler gezogen wurden', () => {
    let wheel = createWheel(players);
    const firstDraw = drawFromWheel(wheel, players, first);
    wheel = firstDraw.state;
    // Der bereits gezogene Spieler ist voruebergehend aus dem Rad entfernt.
    expect(wheel.remaining).not.toContain(firstDraw.drawn);
    expect(wheel.drawn).toContain(firstDraw.drawn);
    // Auch nach mehrfachem Abgleich bleibt er ausgenommen.
    expect(syncWheelPlayers(wheel, players).remaining).not.toContain(firstDraw.drawn);
    expect(wheel.roundsCompleted).toBe(0);
  });

  it('zieht waehrend eines Durchgangs keinen Spieler doppelt', () => {
    let wheel = createWheel(players);
    const firstDraw = drawFromWheel(wheel, players, first);
    wheel = firstDraw.state;
    expect(wheel.remaining).not.toContain(firstDraw.drawn);
    const secondDraw = drawFromWheel(wheel, players, first);
    expect(secondDraw.drawn).not.toBe(firstDraw.drawn);
  });

  it('ist unabhaengig vom Fortschritt der Gewinnleiter (reine Spielerrotation)', () => {
    const wheelA = createWheel(players);
    const wheelB = createWheel(players);
    const drawA = drawFromWheel(wheelA, players, first);
    const drawB = drawFromWheel(wheelB, players, first);
    expect(drawA.drawn).toBe(drawB.drawn);
  });

  it('entfernt ausgeschiedene Spieler und nimmt neue auf', () => {
    let wheel = createWheel(players);
    wheel = drawFromWheel(wheel, players, first).state;
    const synced = syncWheelPlayers(wheel, ['p2', 'p3', 'p4']);
    expect([...synced.remaining].sort()).toEqual(['p2', 'p3', 'p4']);
  });

  it('wirft einen Fehler, wenn keine Spieler vorhanden sind', () => {
    expect(() => drawFromWheel(createWheel([]), [], first)).toThrow();
  });
});
