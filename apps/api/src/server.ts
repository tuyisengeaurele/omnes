/**
 * Process entrypoint. Loads config (fails fast on a bad environment before
 * anything else runs), builds the app, and starts listening. Nothing here
 * is imported by anything else - app.ts is the piece that gets exercised by
 * tests, this file is only ever run directly.
 */

import { createApp } from './app.js';
import { getConfig } from './platform/config.js';
import { getLogger } from './platform/logger.js';
import { disconnectDb } from './platform/db.js';

const config = getConfig();
const logger = getLogger();

const app = createApp({ config, logger });

const server = app.listen(config.API_PORT, () => {
  logger.info({ port: config.API_PORT, env: config.NODE_ENV }, 'api listening');
});

function shutdown(signal: string): void {
  logger.info({ signal }, 'shutting down');
  server.close(() => {
    void disconnectDb().finally(() => process.exit(0));
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
