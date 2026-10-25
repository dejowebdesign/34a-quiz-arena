import crypto from 'node:crypto';
import path from 'node:path';

export interface Config {
  nodeEnv: string;
  port: number;
  dbPath: string;
  sessionSecret: string;
  adminPasswordHash: string;
  /** true, wenn ein zufaelliges Adminpasswort erzeugt wurde (nur Dev). */
  adminPasswordGenerated: boolean;
  /** Nur zur einmaligen Anzeige, wenn ein Passwort generiert wurde. */
  generatedAdminPassword: string | null;
  cookieSecure: boolean;
  trustProxy: boolean;
  allowedOrigins: string[] | null;
  moderatorTtlMs: number;
  /** Optionaler API-Key fuer den KI-Joker. Ohne Key liefert der Joker einen Regelhinweis. */
  openaiApiKey: string | null;
  openaiModel: string;
  openaiBaseUrl: string;
}

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const nodeEnv = env.NODE_ENV ?? 'development';
  const isProd = nodeEnv === 'production';

  const sessionSecret = env.SESSION_SECRET?.trim() || crypto.randomBytes(32).toString('hex');

  let adminPasswordHash = env.ADMIN_PASSWORD_HASH?.trim() ?? '';
  let adminPasswordGenerated = false;
  let generatedAdminPassword: string | null = null;
  if (!adminPasswordHash) {
    const plain = env.ADMIN_PASSWORD?.trim();
    if (plain) {
      // Klartext nur zur Laufzeit einlesen und sofort hashen; nichts wird persistiert.
      const salt = crypto.randomBytes(16);
      const derived = crypto.scryptSync(plain.normalize('NFKC'), salt, 64, { N: 16384, r: 8, p: 1 });
      adminPasswordHash = ['scrypt', 16384, 8, 1, salt.toString('hex'), derived.toString('hex')].join('$');
    } else {
      generatedAdminPassword = crypto.randomBytes(12).toString('base64url');
      const salt = crypto.randomBytes(16);
      const derived = crypto.scryptSync(generatedAdminPassword.normalize('NFKC'), salt, 64, { N: 16384, r: 8, p: 1 });
      adminPasswordHash = ['scrypt', 16384, 8, 1, salt.toString('hex'), derived.toString('hex')].join('$');
      adminPasswordGenerated = true;
    }
  }

  const origins = env.ALLOWED_ORIGINS?.split(',').map((o) => o.trim()).filter(Boolean);

  return {
    nodeEnv,
    port: Number(env.PORT ?? 3000),
    dbPath: env.DB_PATH ?? path.resolve(process.cwd(), 'data', 'quiz-arena.db'),
    sessionSecret,
    adminPasswordHash,
    adminPasswordGenerated,
    generatedAdminPassword,
    cookieSecure: bool(env.COOKIE_SECURE, isProd),
    trustProxy: bool(env.TRUST_PROXY, true),
    allowedOrigins: origins && origins.length > 0 ? origins : null,
    moderatorTtlMs: Number(env.MODERATOR_TTL_MS ?? 12 * 60 * 60 * 1000),
    openaiApiKey: env.OPENAI_API_KEY?.trim() || null,
    openaiModel: env.OPENAI_MODEL?.trim() || 'gpt-4o-mini',
    openaiBaseUrl: env.OPENAI_BASE_URL?.trim() || 'https://api.openai.com/v1',
  };
}
