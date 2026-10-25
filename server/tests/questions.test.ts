import { beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type Db } from '../src/db/database.js';
import { QuestionRepository, ValidationError, validateQuestionInput } from '../src/db/questions.js';

const VALID = {
  topic: 'straf_verfahrensrecht',
  difficulty: 'mittel',
  text: 'Welche Aussage zum Strafverfahren ist richtig?',
  options: ['A', 'B', 'C', 'D'],
  correctIndex: 1,
  explanation: 'Begruendung.',
  legalBasis: '§ 152 StPO',
  legalStatus: 'unverified',
  sourceNote: 'Gesetzestext, Stand 2024',
  status: 'draft',
};

describe('Fragenvalidierung', () => {
  it('akzeptiert eine vollstaendige Frage', () => {
    const result = validateQuestionInput(VALID);
    expect(result.correctIndex).toBe(1);
    expect(result.options).toHaveLength(4);
  });

  it('verlangt genau vier Antwortoptionen', () => {
    expect(() => validateQuestionInput({ ...VALID, options: ['A', 'B', 'C'] })).toThrow(ValidationError);
    expect(() => validateQuestionInput({ ...VALID, options: ['A', 'B', 'C', 'D', 'E'] })).toThrow(ValidationError);
  });

  it('verlangt einen gueltigen correctIndex', () => {
    expect(() => validateQuestionInput({ ...VALID, correctIndex: 4 })).toThrow(/correctIndex/);
    expect(() => validateQuestionInput({ ...VALID, correctIndex: -1 })).toThrow(/correctIndex/);
  });

  it('verlangt ein bekanntes Themengebiet', () => {
    expect(() => validateQuestionInput({ ...VALID, topic: 'erfunden' })).toThrow(/Themengebiet/);
  });

  it('verlangt einen bekannten Schwierigkeitsgrad', () => {
    expect(() => validateQuestionInput({ ...VALID, difficulty: 'unmoeglich' })).toThrow(/Schwierigkeitsgrad/);
  });

  it('verhindert doppelte Antwortoptionen', () => {
    expect(() => validateQuestionInput({ ...VALID, options: ['A', 'A', 'C', 'D'] })).toThrow(/eindeutig/);
  });

  it('stuft eine Rechtsfrage ohne Quelle als pruefbeduerftig ein', () => {
    const result = validateQuestionInput({ ...VALID, legalStatus: 'verified', sourceNote: null });
    expect(result.legalStatus).toBe('needs_review');
  });

  it('behaelt "verified" nur mit Rechtsgrundlage und Quelle bei', () => {
    const result = validateQuestionInput({ ...VALID, legalStatus: 'verified' });
    expect(result.legalStatus).toBe('verified');
  });
});

describe('Fragenrepository', () => {
  let db: Db;
  let repo: QuestionRepository;

  beforeEach(() => {
    db = openDatabase(':memory:');
    repo = new QuestionRepository(db);
  });

  it('legt eine Frage an und liest sie zurueck', () => {
    const created = repo.create(validateQuestionInput(VALID));
    expect(created.id).toBeGreaterThan(0);
    const loaded = repo.get(created.id);
    expect(loaded?.text).toBe(VALID.text);
    expect(loaded?.options).toEqual(VALID.options);
  });

  it('aktualisiert eine Frage', () => {
    const created = repo.create(validateQuestionInput(VALID));
    const updated = repo.update(created.id, validateQuestionInput({ ...VALID, text: 'Geaenderte Frage?' }));
    expect(updated?.text).toBe('Geaenderte Frage?');
  });

  it('aendert den Status und filtert danach', () => {
    const created = repo.create(validateQuestionInput(VALID));
    repo.setStatus(created.id, 'approved');
    expect(repo.approved()).toHaveLength(1);
    expect(repo.countApproved()).toBe(1);
    expect(repo.list({ status: 'draft' })).toHaveLength(0);
  });

  it('loescht eine Frage', () => {
    const created = repo.create(validateQuestionInput(VALID));
    expect(repo.delete(created.id)).toBe(true);
    expect(repo.get(created.id)).toBeNull();
  });

  it('importiert mehrere Fragen und meldet fehlerhafte Eintraege einzeln', () => {
    const result = repo.importMany([VALID, { ...VALID, options: ['nur', 'zwei'] }, { ...VALID, text: 'Zweite gute Frage?' }]);
    expect(result.created).toHaveLength(2);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.index).toBe(1);
  });

  it('importiert eine fehlerhafte Charge nicht teilweise bei einem Transaktionsfehler', () => {
    const result = repo.importMany([{ ...VALID, topic: 'unbekannt' }]);
    expect(result.created).toHaveLength(0);
    expect(repo.list()).toHaveLength(0);
  });
});
