import type { TeamId } from '@quiz/shared';
import type { Db } from './database.js';

export interface CertificateRecord {
  id: string;
  playerName: string;
  team: TeamId;
  level: number;
  issuedAt: string;
}

export const CERTIFICATE_DISCLAIMER =
  '34A Quiz Arena - Leistungszertifikat. Dieses Dokument bestaetigt die Teilnahme an einer Quizshow zur Uebung. ' +
  'Es ist kein amtlicher Nachweis der bestandenen Sachkundepruefung nach § 34a GewO und ersetzt keine Pruefung bei der zustaendigen IHK.';

interface CertificateRow {
  id: string;
  player_name: string;
  team: string;
  level: number;
  issued_at: string;
}

export class CertificateRepository {
  constructor(private readonly db: Db) {}

  create(record: CertificateRecord): CertificateRecord {
    this.db
      .prepare('INSERT INTO certificates (id, player_name, team, level, issued_at) VALUES (?, ?, ?, ?, ?)')
      .run(record.id, record.playerName, record.team, record.level, record.issuedAt);
    return record;
  }

  get(id: string): CertificateRecord | null {
    const row = this.db.prepare('SELECT * FROM certificates WHERE id = ?').get(id) as CertificateRow | undefined;
    if (!row) return null;
    return { id: row.id, playerName: row.player_name, team: row.team as TeamId, level: row.level, issuedAt: row.issued_at };
  }

  list(limit = 100): CertificateRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM certificates ORDER BY issued_at DESC LIMIT ?')
      .all(limit) as CertificateRow[];
    return rows.map((row) => ({
      id: row.id,
      playerName: row.player_name,
      team: row.team as TeamId,
      level: row.level,
      issuedAt: row.issued_at,
    }));
  }
}
