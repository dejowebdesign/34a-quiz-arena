import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

export type Db = Database.Database;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS questions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  topic         TEXT    NOT NULL,
  difficulty    TEXT    NOT NULL,
  text          TEXT    NOT NULL,
  options       TEXT    NOT NULL,
  correct_index INTEGER NOT NULL,
  explanation   TEXT    NOT NULL DEFAULT '',
  legal_basis   TEXT,
  legal_status  TEXT    NOT NULL DEFAULT 'unverified',
  source_note   TEXT,
  status        TEXT    NOT NULL DEFAULT 'draft',
  created_at    TEXT    NOT NULL,
  updated_at    TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_questions_status ON questions(status);
CREATE INDEX IF NOT EXISTS idx_questions_topic ON questions(topic);

CREATE TABLE IF NOT EXISTS certificates (
  id          TEXT    PRIMARY KEY,
  player_name TEXT    NOT NULL,
  team        TEXT    NOT NULL,
  level       INTEGER NOT NULL,
  issued_at   TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_certificates_issued ON certificates(issued_at);
`;

export function openDatabase(dbPath: string): Db {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}
