import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import express from 'express';
import helmet from 'helmet';
import { loadConfig, type Config } from './config.js';
import { openDatabase, type Db } from './db/database.js';
import { QuestionRepository } from './db/questions.js';
import { CertificateRepository } from './db/certificates.js';
import { createAuth } from './http/auth.js';
import { createRoutes } from './http/routes.js';
import { createRealtime } from './realtime/socket.js';
import { SessionManager } from './engine/session-manager.js';
import { createHintProvider } from './engine/hints.js';

export interface AppContext {
  config: Config;
  db: Db;
  questions: QuestionRepository;
  certificates: CertificateRepository;
  sessions: SessionManager;
  app: express.Express;
  server: http.Server;
  io: ReturnType<typeof createRealtime>['io'];
  close: () => Promise<void>;
}

export interface CreateAppOptions {
  config?: Config;
  dbPath?: string;
  /** Verzeichnis mit dem gebauten Frontend. */
  clientDist?: string | null;
}

/** Baut die komplette Anwendung auf. Wird von index.ts und den Tests genutzt. */
export function createApp(options: CreateAppOptions = {}): AppContext {
  const config = options.config ?? loadConfig();
  const db = openDatabase(options.dbPath ?? config.dbPath);
  const questions = new QuestionRepository(db);
  const certificates = new CertificateRepository(db);
  const auth = createAuth(config);

  const sessions = new SessionManager({
    secret: config.sessionSecret,
    certificates,
    hintProvider: createHintProvider(config),
    // Die Anzahl spielbarer Fragen stammt aus dem Katalog und wird zur Laufzeit
    // abgefragt, damit Aenderungen an der Freigabe sofort greifen.
    approvedQuestionCount: () => questions.countApproved(),
  });

  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use('/api', createRoutes({ config, auth, questions, certificates, sessions }));

  // Gebautes Frontend ausliefern, falls vorhanden.
  const clientDist = options.clientDist === undefined ? path.resolve(process.cwd(), 'client', 'dist') : options.clientDist;
  if (clientDist && fs.existsSync(clientDist)) {
    app.use(express.static(clientDist, { index: false }));
    app.get(/^\/(?!api|socket\.io).*/, (_req, res) => {
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }

  const server = http.createServer(app);
  const { io } = createRealtime(server, { config, auth, sessions, questions, certificates });

  const close = async (): Promise<void> => {
    await new Promise<void>((resolve) => io.close(() => resolve()));
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
  };

  return { config, db, questions, certificates, sessions, app, server, io, close };
}
