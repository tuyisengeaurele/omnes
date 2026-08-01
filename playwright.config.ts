import 'dotenv/config';
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  // The main e2e test covers bootstrap, real pg_dump/pg_restore-backed
  // backup/verify/restore, product creation, and a full POS checkout in
  // one run — each real I/O step needs headroom beyond the default 30s.
  timeout: 90_000,
  retries: 0,
  reporter: 'list',
});
