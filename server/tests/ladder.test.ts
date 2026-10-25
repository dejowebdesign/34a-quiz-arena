import { describe, expect, it } from 'vitest';
import {
  applyCorrectAnswer,
  applyWrongAnswer,
  normalizeSafetyLevels,
  safetyFloorFor,
} from '@quiz/shared';

describe('Gewinnleiter: Aufstieg', () => {
  it('steigt bei richtiger Antwort um genau eine Stufe', () => {
    expect(applyCorrectAnswer(0, [5, 10]).level).toBe(1);
    expect(applyCorrectAnswer(4, [5, 10]).level).toBe(5);
    expect(applyCorrectAnswer(9, [5, 10]).level).toBe(10);
  });

  it('deckelt bei Stufe 15 und meldet die bestandene Challenge', () => {
    const result = applyCorrectAnswer(14, [5, 10]);
    expect(result.level).toBe(15);
    expect(result.completed).toBe(true);
    expect(applyCorrectAnswer(15, [5, 10]).level).toBe(15);
  });

  it('meldet Stufe 14 nicht als bestanden', () => {
    expect(applyCorrectAnswer(13, [5, 10]).completed).toBe(false);
  });
});

describe('Gewinnleiter: Rueckfall auf Sicherheitsstufen', () => {
  it('faellt auf Stufe 5 zurueck, wenn die Sicherheitsstufe erreicht war', () => {
    expect(applyWrongAnswer(7, [5, 10]).level).toBe(5);
  });

  it('faellt auf Stufe 10 zurueck, wenn diese erreicht war', () => {
    expect(applyWrongAnswer(12, [5, 10]).level).toBe(10);
  });

  it('faellt auf 0 zurueck, solange keine Sicherheitsstufe erreicht wurde', () => {
    expect(applyWrongAnswer(3, [5, 10]).level).toBe(0);
  });

  it('behaelt den Fortschritt oberhalb der hoechsten Sicherheitsstufe nicht', () => {
    // Zwischen 10 und 15 gibt es keine weitere Sicherheitsstufe.
    expect(applyWrongAnswer(14, [5, 10]).level).toBe(10);
  });

  it('schliesst kein Team aus: eine falsche Antwort fuehrt nie zu einem Endzustand', () => {
    const result = applyWrongAnswer(0, [5, 10]);
    expect(result.completed).toBe(false);
    expect(result.level).toBe(0);
  });

  it('arbeitet mit abweichenden Sicherheitsstufen', () => {
    expect(applyWrongAnswer(8, [3, 6, 12]).level).toBe(6);
    expect(applyWrongAnswer(11, [3, 6, 12]).level).toBe(6);
    expect(safetyFloorFor(12, [3, 6, 12])).toBe(12);
  });
});

describe('Sicherheitsstufen: Normalisierung', () => {
  it('entfernt Duplikate, sortiert und ignoriert ungueltige Werte', () => {
    expect(normalizeSafetyLevels([10, 5, 5, 0, 15, 16, -2, 3.5, 7])).toEqual([5, 7, 10]);
  });

  it('akzeptiert eine leere Liste', () => {
    expect(normalizeSafetyLevels([])).toEqual([]);
    expect(applyWrongAnswer(9, []).level).toBe(0);
  });
});
