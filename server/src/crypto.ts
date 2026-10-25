import crypto from 'node:crypto';

/**
 * Passwort-Hashing mit scrypt. Format: scrypt$N$r$p$salt$hash (jeweils hex).
 * Keine Klartextpasswoerter in Konfiguration oder Datenbank.
 */

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 64;

function scryptAsync(password: string, salt: Buffer, keylen: number, options: crypto.ScryptOptions) {
  return new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(password.normalize('NFKC'), salt, keylen, options, (err, derived) => {
      if (err) reject(err);
      else resolve(derived);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const derived = await scryptAsync(password, salt, KEY_LEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return ['scrypt', SCRYPT_N, SCRYPT_R, SCRYPT_P, salt.toString('hex'), derived.toString('hex')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const salt = Buffer.from(parts[4] as string, 'hex');
  const expected = Buffer.from(parts[5] as string, 'hex');
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  try {
    const derived = await scryptAsync(password, salt, expected.length, { N, r, p, maxmem: 256 * 1024 * 1024 });
    return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

/** HMAC-signiertes, zustandsloses Token (ueberlebt Serverneustart). */
export function signToken(payload: Record<string, unknown>, secret: string, ttlMs: number): string {
  const body = { ...payload, exp: Date.now() + ttlMs };
  const data = Buffer.from(JSON.stringify(body)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(data).digest('base64url');
  return `${data}.${sig}`;
}

export function verifyToken<T = Record<string, unknown>>(token: string, secret: string): (T & { exp: number }) | null {
  const [data, sig] = token.split('.');
  if (!data || !sig) return null;
  const expected = crypto.createHmac('sha256', secret).update(data).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(data, 'base64url').toString('utf8')) as T & { exp: number };
    if (typeof parsed.exp !== 'number' || parsed.exp < Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function randomCode(length = 6): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i += 1) {
    out += alphabet[(bytes[i] as number) % alphabet.length];
  }
  return out;
}

export function randomId(): string {
  return crypto.randomUUID();
}
