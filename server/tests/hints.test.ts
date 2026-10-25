import { describe, expect, it } from 'vitest';
import { sanitizeHint } from '../src/engine/hints.js';
import { makeQuestion } from './helpers.js';

describe('KI-Joker: Schutz vor Preisgabe der Loesung', () => {
  const question = makeQuestion({
    correctIndex: 0,
    options: ['Erlaubnisbehoerde der Gemeinde', 'Finanzamt', 'Polizei', 'Gewerbeaufsicht'],
  });

  it('ersetzt einen Hinweis, der die richtige Antwort woertlich enthaelt', () => {
    const hint = 'Die zustaendige Stelle ist die Erlaubnisbehoerde der Gemeinde.';
    const sanitized = sanitizeHint(hint, question);
    expect(sanitized.toLowerCase()).not.toContain('erlaubnisbehoerde der gemeinde');
    expect(sanitized).toContain('Die richtige Antwort wird bewusst nicht genannt');
  });

  it('behaelt einen Hinweis ohne Loesung bei', () => {
    const hint = 'Pruefe die Gewerbeordnung und die Zustaendigkeit der oertlichen Behoerde.';
    expect(sanitizeHint(hint, question)).toBe(hint);
  });

  it('ist unempfindlich gegen Gross-/Kleinschreibung', () => {
    const hint = 'Die ERLAUBNISBEHOERDE DER GEMEINDE ist zustaendig.';
    expect(sanitizeHint(hint, question)).not.toBe(hint);
  });
});
