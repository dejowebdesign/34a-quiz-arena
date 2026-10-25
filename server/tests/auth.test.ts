import { describe, expect, it } from 'vitest';
import { hashPassword, signToken, verifyPassword, verifyToken } from '../src/crypto.js';

describe('Passwort-Hashing', () => {
  it('akzeptiert das richtige Passwort', async () => {
    const hash = await hashPassword('geheim-123');
    expect(await verifyPassword('geheim-123', hash)).toBe(true);
  });

  it('weist ein falsches Passwort ab', async () => {
    const hash = await hashPassword('geheim-123');
    expect(await verifyPassword('geheim-124', hash)).toBe(false);
  });

  it('erzeugt fuer dasselbe Passwort unterschiedliche Hashes (Salt)', async () => {
    const a = await hashPassword('gleich');
    const b = await hashPassword('gleich');
    expect(a).not.toBe(b);
    expect(await verifyPassword('gleich', a)).toBe(true);
    expect(await verifyPassword('gleich', b)).toBe(true);
  });

  it('weist beschaedigte Hashes ab, statt zu werfen', async () => {
    expect(await verifyPassword('x', 'kaputt')).toBe(false);
    expect(await verifyPassword('x', 'scrypt$a$b$c$d$e')).toBe(false);
  });
});

describe('Signierte Tokens', () => {
  const secret = 'test-secret';

  it('verifiziert ein gueltiges Token', () => {
    const token = signToken({ role: 'moderator' }, secret, 60_000);
    expect(verifyToken<{ role: string }>(token, secret)?.role).toBe('moderator');
  });

  it('weist ein manipuliertes Token ab', () => {
    const token = signToken({ role: 'candidate' }, secret, 60_000);
    const [data] = token.split('.');
    const forged = `${data}.gefaelschte-signatur`;
    expect(verifyToken(forged, secret)).toBeNull();
  });

  it('weist ein Token mit falschem Geheimnis ab', () => {
    const token = signToken({ role: 'moderator' }, secret, 60_000);
    expect(verifyToken(token, 'anderes-geheimnis')).toBeNull();
  });

  it('weist ein abgelaufenes Token ab', () => {
    const token = signToken({ role: 'moderator' }, secret, -1);
    expect(verifyToken(token, secret)).toBeNull();
  });

  it('erlaubt die Rollenerhoehung nicht durch Manipulation der Nutzlast', () => {
    // Nutzlast eines Kandidaten-Tickets veraendern und mit gleicher Signatur senden.
    const candidate = signToken({ role: 'candidate', sessionCode: 'ABC123' }, secret, 60_000);
    const [data, signature] = candidate.split('.');
    const decoded = JSON.parse(Buffer.from(data as string, 'base64url').toString('utf8')) as Record<string, unknown>;
    decoded.role = 'moderator';
    const forgedData = Buffer.from(JSON.stringify(decoded)).toString('base64url');
    expect(verifyToken(`${forgedData}.${signature}`, secret)).toBeNull();
  });
});
