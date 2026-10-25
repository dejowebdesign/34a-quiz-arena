import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../src/db/database.js';
import { QuestionRepository } from '../src/db/questions.js';

describe('Beispielfragen', () => {
  it('lassen sich fehlerfrei importieren', () => {
    // Pfad unabhaengig vom Arbeitsverzeichnis aufloesen.
    const here = path.dirname(fileURLToPath(import.meta.url));
    const file = path.resolve(here, '..', '..', 'examples', 'questions.sample.json');
    const data = JSON.parse(fs.readFileSync(file, 'utf8')) as { questions: unknown[] };
    const repo = new QuestionRepository(openDatabase(':memory:'));
    const result = repo.importMany(data.questions);
    expect(result.errors).toEqual([]);
    expect(result.created).toHaveLength(data.questions.length);
    // Ohne Quelle darf kein Rechtsstatus "geprueft" entstehen.
    for (const q of result.created) {
      if (!q.sourceNote) expect(q.legalStatus).not.toBe('verified');
    }
  });
});
