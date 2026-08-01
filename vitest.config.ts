import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const root = import.meta.dirname;

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(root, 'src'),
      '@shared': resolve(root, 'shared'),
      '@branding': resolve(root, 'assets/branding'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./tests/unit/setup.ts'],
    include: ['tests/unit/**/*.test.{ts,tsx}'],
    // Every test file that touches Prisma hits the same real local
    // Postgres database (deliberately — see the project's "test real
    // behavior, not mocks" philosophy), not an isolated per-file schema.
    // Vitest's default file-level parallelism races those files against
    // each other: auth.test.ts's indiscriminate `prisma.user.deleteMany()`
    // can wipe a User row another file's test just created mid-run. Forcing
    // sequential file execution is what actually matches this suite's
    // shared-database model.
    fileParallelism: false,
  },
});
