import type { NextFunction, Request, Response } from 'express';
import { hashPassword, signToken, verifyPassword, verifyToken } from '../crypto.js';
import type { Config } from '../config.js';

declare module 'express-serve-static-core' {
  interface Request {
    moderator?: { authenticated: true };
  }
}

/**
 * Moderatorenschutz: HTTP Basic gegen einen scrypt-Hash. Bei Erfolg wird
 * zusaetzlich ein signiertes Token ausgestellt, damit Socket.IO-Verbindungen
 * nicht bei jeder Nachricht Basic-Credentials mitsenden muessen.
 */
export function createAuth(config: Config) {
  const tokenTtlMs = config.moderatorTtlMs;
  const adminUser = process.env.ADMIN_USER ?? 'moderator';

  async function checkCredentials(user: string, password: string): Promise<boolean> {
    if (user !== adminUser) return false;
    return verifyPassword(password, config.adminPasswordHash);
  }

  function tokenIsModerator(token: string): boolean {
    const payload = verifyToken<{ role?: string }>(token, config.sessionSecret);
    return payload?.role === 'moderator';
  }

  async function basicAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
    const header = req.header('authorization') ?? '';

    if (header.startsWith('Bearer ')) {
      if (tokenIsModerator(header.slice(7))) {
        req.moderator = { authenticated: true };
        next();
        return;
      }
      res.status(401).json({ code: 'unauthorized', message: 'Token ist ungueltig oder abgelaufen.' });
      return;
    }

    if (!header.startsWith('Basic ')) {
      res.setHeader('WWW-Authenticate', 'Basic realm="34A Quiz Arena Moderation", charset="UTF-8"');
      res.status(401).json({ code: 'unauthorized', message: 'Moderatorenzugang erforderlich.' });
      return;
    }

    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
    const separator = decoded.indexOf(':');
    const user = separator >= 0 ? decoded.slice(0, separator) : '';
    const password = separator >= 0 ? decoded.slice(separator + 1) : '';

    if (!(await checkCredentials(user, password))) {
      res.status(401).json({ code: 'unauthorized', message: 'Zugangsdaten sind ungueltig.' });
      return;
    }
    req.moderator = { authenticated: true };
    next();
  }

  return {
    basicAuth,
    checkCredentials,
    tokenIsModerator,
    issueModeratorToken: (): string => signToken({ role: 'moderator' }, config.sessionSecret, tokenTtlMs),
    hashPassword,
  };
}

export type Auth = ReturnType<typeof createAuth>;
