import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['./vitest.setup.ts'],
    // Integration tests share one Postgres database and must not run
    // concurrently against it: two test files both creating and deleting
    // rows for the same phone number would flake on each other.
    fileParallelism: false,
  },
});
