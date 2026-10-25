import { createApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const context = createApp({ config });

context.server.listen(config.port, () => {
  console.log(`34A Quiz Arena - Server laeuft auf Port ${config.port} (${config.nodeEnv}).`);
  console.log(`Datenbank: ${config.dbPath}`);
  if (config.adminPasswordGenerated && config.generatedAdminPassword) {
    console.warn('ACHTUNG: Kein ADMIN_PASSWORD gesetzt. Ein temporaeres Passwort wurde erzeugt:');
    console.warn(`  Benutzer: ${process.env.ADMIN_USER ?? 'moderator'}`);
    console.warn(`  Passwort: ${config.generatedAdminPassword}`);
    console.warn('Dieses Passwort ist nur einmalig sichtbar. Bitte ADMIN_PASSWORD oder ADMIN_PASSWORD_HASH setzen.');
  }
});

const shutdown = (signal: string) => {
  console.log(`Signal ${signal} empfangen, Server wird beendet.`);
  context
    .close()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
