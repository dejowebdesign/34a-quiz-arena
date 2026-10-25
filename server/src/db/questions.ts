import {
  DIFFICULTIES,
  LEGAL_STATUS_LABELS,
  OPTION_COUNT,
  TOPICS,
  type Difficulty,
  type LegalStatus,
  type QuestionRecord,
  type QuestionStatus,
  type Topic,
} from '@quiz/shared';
import type { Db } from './database.js';

interface QuestionRow {
  id: number;
  topic: string;
  difficulty: string;
  text: string;
  options: string;
  correct_index: number;
  explanation: string;
  legal_basis: string | null;
  legal_status: string;
  source_note: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface QuestionInput {
  topic: Topic;
  difficulty: Difficulty;
  text: string;
  options: string[];
  correctIndex: number;
  explanation?: string;
  legalBasis?: string | null;
  legalStatus?: LegalStatus;
  sourceNote?: string | null;
  status?: QuestionStatus;
}

export class ValidationError extends Error {
  readonly details: string[];
  constructor(details: string[]) {
    super(`Ungueltige Eingabe: ${details.join('; ')}`);
    this.name = 'ValidationError';
    this.details = details;
  }
}

const VALID_STATUS = ['draft', 'review', 'approved', 'archived'] as const;
const VALID_LEGAL = ['unverified', 'verified', 'needs_review'] as const;

function toRecord(row: QuestionRow): QuestionRecord {
  return {
    id: row.id,
    topic: row.topic as Topic,
    difficulty: row.difficulty as Difficulty,
    text: row.text,
    options: JSON.parse(row.options) as string[],
    correctIndex: row.correct_index,
    explanation: row.explanation,
    legalBasis: row.legal_basis,
    legalStatus: row.legal_status as LegalStatus,
    sourceNote: row.source_note,
    status: row.status as QuestionStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Validiert eine Frage streng, damit fehlerhafte Importe nicht in die DB gelangen. */
export function validateQuestionInput(input: unknown): QuestionInput {
  const errors: string[] = [];
  const raw = (input ?? {}) as Record<string, unknown>;

  const topic = raw.topic as Topic;
  if (!TOPICS.includes(topic)) errors.push(`Unbekanntes Themengebiet: ${String(raw.topic)}`);

  const difficulty = raw.difficulty as Difficulty;
  if (!DIFFICULTIES.includes(difficulty)) errors.push(`Unbekannter Schwierigkeitsgrad: ${String(raw.difficulty)}`);

  const text = typeof raw.text === 'string' ? raw.text.trim() : '';
  if (text.length < 5) errors.push('Fragetext fehlt oder ist zu kurz.');

  const options = Array.isArray(raw.options) ? raw.options.map((o) => String(o ?? '').trim()) : [];
  if (options.length !== OPTION_COUNT) errors.push(`Es sind genau ${OPTION_COUNT} Antwortoptionen erforderlich.`);
  if (options.some((o) => o.length === 0)) errors.push('Antwortoptionen duerfen nicht leer sein.');
  if (new Set(options.map((o) => o.toLowerCase())).size !== options.length) errors.push('Antwortoptionen muessen eindeutig sein.');

  const correctIndex = Number(raw.correctIndex);
  if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= OPTION_COUNT) {
    errors.push('correctIndex muss zwischen 0 und 3 liegen.');
  }

  const legalStatus = (raw.legalStatus ?? 'unverified') as LegalStatus;
  if (!VALID_LEGAL.includes(legalStatus)) errors.push(`Unbekannter Rechtsstatus: ${String(raw.legalStatus)}`);

  const status = (raw.status ?? 'draft') as QuestionStatus;
  if (!VALID_STATUS.includes(status)) errors.push(`Unbekannter Status: ${String(raw.status)}`);

  const legalBasis = raw.legalBasis === undefined || raw.legalBasis === null ? null : String(raw.legalBasis).trim() || null;
  const sourceNote = raw.sourceNote === undefined || raw.sourceNote === null ? null : String(raw.sourceNote).trim() || null;

  // Rechtsfragen ohne Quellenangabe muessen als ungeprueft gelten.
  let effectiveLegal = legalStatus;
  if (legalStatus === 'verified' && (!legalBasis || !sourceNote)) {
    effectiveLegal = 'needs_review';
  }

  if (errors.length > 0) throw new ValidationError(errors);

  return {
    topic,
    difficulty,
    text,
    options,
    correctIndex,
    explanation: typeof raw.explanation === 'string' ? raw.explanation.trim() : '',
    legalBasis,
    legalStatus: effectiveLegal,
    sourceNote,
    status,
  };
}

export class QuestionRepository {
  constructor(private readonly db: Db) {}

  list(filter: { status?: QuestionStatus; topic?: Topic } = {}): QuestionRecord[] {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filter.status) {
      clauses.push('status = ?');
      params.push(filter.status);
    }
    if (filter.topic) {
      clauses.push('topic = ?');
      params.push(filter.topic);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.db.prepare(`SELECT * FROM questions ${where} ORDER BY id ASC`).all(...params) as QuestionRow[];
    return rows.map(toRecord);
  }

  get(id: number): QuestionRecord | null {
    const row = this.db.prepare('SELECT * FROM questions WHERE id = ?').get(id) as QuestionRow | undefined;
    return row ? toRecord(row) : null;
  }

  create(input: QuestionInput): QuestionRecord {
    const now = new Date().toISOString();
    const info = this.db
      .prepare(
        `INSERT INTO questions
          (topic, difficulty, text, options, correct_index, explanation, legal_basis, legal_status, source_note, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.topic,
        input.difficulty,
        input.text,
        JSON.stringify(input.options),
        input.correctIndex,
        input.explanation ?? '',
        input.legalBasis ?? null,
        input.legalStatus ?? 'unverified',
        input.sourceNote ?? null,
        input.status ?? 'draft',
        now,
        now,
      );
    const created = this.get(Number(info.lastInsertRowid));
    if (!created) throw new Error('Frage konnte nicht angelegt werden.');
    return created;
  }

  update(id: number, input: QuestionInput): QuestionRecord | null {
    const existing = this.get(id);
    if (!existing) return null;
    this.db
      .prepare(
        `UPDATE questions SET
           topic = ?, difficulty = ?, text = ?, options = ?, correct_index = ?, explanation = ?,
           legal_basis = ?, legal_status = ?, source_note = ?, status = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        input.topic,
        input.difficulty,
        input.text,
        JSON.stringify(input.options),
        input.correctIndex,
        input.explanation ?? '',
        input.legalBasis ?? null,
        input.legalStatus ?? 'unverified',
        input.sourceNote ?? null,
        input.status ?? existing.status,
        new Date().toISOString(),
        id,
      );
    return this.get(id);
  }

  setStatus(id: number, status: QuestionStatus): QuestionRecord | null {
    this.db.prepare('UPDATE questions SET status = ?, updated_at = ? WHERE id = ?').run(status, new Date().toISOString(), id);
    return this.get(id);
  }

  delete(id: number): boolean {
    const info = this.db.prepare('DELETE FROM questions WHERE id = ?').run(id);
    return info.changes > 0;
  }

  countApproved(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS c FROM questions WHERE status = 'approved'").get() as { c: number };
    return row.c;
  }

  /** Freigegebene Fragen, optional gefiltert. */
  approved(topic?: Topic, difficulty?: Difficulty): QuestionRecord[] {
    const clauses = ["status = 'approved'"];
    const params: unknown[] = [];
    if (topic) {
      clauses.push('topic = ?');
      params.push(topic);
    }
    if (difficulty) {
      clauses.push('difficulty = ?');
      params.push(difficulty);
    }
    const rows = this.db
      .prepare(`SELECT * FROM questions WHERE ${clauses.join(' AND ')} ORDER BY id ASC`)
      .all(...params) as QuestionRow[];
    return rows.map(toRecord);
  }

  /**
   * Import aus JSON. Der Import erfolgt immer als Entwurf oder explizit
   * angegebenem Status; es werden keine Quellen erfunden.
   */
  importMany(items: unknown[]): { created: QuestionRecord[]; errors: { index: number; message: string }[] } {
    const created: QuestionRecord[] = [];
    const errors: { index: number; message: string }[] = [];
    const insert = this.db.transaction((rows: unknown[]) => {
      rows.forEach((raw, index) => {
        try {
          created.push(this.create(validateQuestionInput(raw)));
        } catch (error) {
          errors.push({ index, message: error instanceof Error ? error.message : 'Unbekannter Fehler' });
        }
      });
    });
    insert(items);
    return { created, errors };
  }

  legalStatusLabels(): typeof LEGAL_STATUS_LABELS {
    return LEGAL_STATUS_LABELS;
  }
}
