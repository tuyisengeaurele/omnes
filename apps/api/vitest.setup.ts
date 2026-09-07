/**
 * Loads apps/api/.env.test into process.env before any test file imports
 * run, so getConfig() sees a valid test environment pointed at omnes_test
 * rather than throwing or, worse, silently falling through to whatever a
 * developer's shell happens to have set.
 *
 * A value already present in process.env is left alone, so CI can set real
 * environment variables instead of needing this file to exist there.
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const envTestPath = join(here, '.env.test');

if (existsSync(envTestPath)) {
  const lines = readFileSync(envTestPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    process.env[key] ??= value;
  }
} else {
  console.warn(
    `[vitest.setup] ${envTestPath} not found. Integration tests that need a database will fail. Copy .env.test.example to apps/api/.env.test and fill in DATABASE_URL.`
  );
}
