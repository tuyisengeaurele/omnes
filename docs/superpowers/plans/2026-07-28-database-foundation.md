# Database Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire Prisma to the local PostgreSQL instance, add a main-process connection service, and prove the connection works end to end (IPC + shell UI) — with zero business tables.

**Architecture:** `prisma/schema.prisma` holds only the datasource/generator (no models). A `PrismaClient` singleton, constructed with a `@prisma/adapter-pg` driver adapter, lives in `electron/main/services/core/database.ts`. A `database:health-check` IPC channel (same pattern as `app:get-version` from Foundation) round-trips a real `SELECT 1` to the renderer, shown as a status badge in `AppShell`.

**Tech Stack:** Prisma 7 (`prisma` + `@prisma/client`), `@prisma/adapter-pg` + `pg` (driver adapter), `dotenv`, PostgreSQL 17 (local, already installed and running), builds on the Foundation Electron/React/TypeScript shell.

**Prerequisite (already done):** Local PostgreSQL role `omnes` (with `CREATEDB`, needed for Prisma's shadow database — see Task 3) and database `omnes_dev` created; `.env` at the project root contains `DATABASE_URL` (gitignored, never read or written directly by any task in this plan — Prisma and our own code read it from the environment at runtime, and every verification in this plan checks only a boolean `connected` result, never the connection string itself).

---

## Important corrections vs. the original draft of this plan

This plan was originally written assuming Prisma's older architecture (an embedded `url` in the `datasource` block, a built-in native query-engine binary requiring `asarUnpack` in Electron). The actual installed version is **Prisma 7.9.1**, which turned out to have a materially different architecture, discovered by actually running the tools rather than assuming:

1. **`datasource { url = env("DATABASE_URL") }` is no longer valid.** Prisma 7 requires a `prisma.config.ts` file at the repo root that loads the connection URL (via `dotenv/config` + `process.env.DATABASE_URL`) for CLI tooling (`migrate`, `studio`, `generate`).
2. **The default generator changed from `prisma-client-js` to `prisma-client`**, and now requires an explicit `output` path — it generates plain `.ts` source files into that folder (`generated/prisma/` in this project, gitignored, regenerated via `postinstall`), not a pre-built package under `node_modules/.prisma`.
3. **Runtime `PrismaClient` now requires an explicit driver adapter.** The old built-in Rust query engine binary is no longer the default path — `new PrismaClient()` alone doesn't work; you construct it with `new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })`, using `@prisma/adapter-pg`, which wraps the plain-JS `pg` driver.
4. **This eliminates the native-binary packaging problem entirely.** Verified directly: `find`-ing for `.node` files in the generated client, `@prisma/adapter-pg`, and `pg` turned up nothing. `pnpm build` bundled everything (generated client, adapter, `pg`, `dotenv`) into `out/main/index.js` via Rollup's normal bundling with **no special `external` config needed** — the externalization plan (originally Task 5) and asar-unpacking plan (originally Task 11) are unnecessary and have been removed from this plan.
5. **`prisma migrate dev` needs the database role to have `CREATEDB`** (for its temporary shadow database), which is a separate grant from the `LOGIN`/ownership already set up — this required one more one-time manual step (documented in Task 3).
6. **With zero models, `prisma migrate dev` produces no migration files and no `_prisma_migrations` table** — Prisma only creates that tracking table when there's an actual schema diff to apply. The "proof this works" for this sub-project is the real `SELECT 1` health check, not a migration artifact.
7. **The packaged (electron-builder) app will show "Database offline", not "Database connected"** — `.env` is gitignored and deliberately not shipped in the package (it's a dev-only convenience, not how a production install should get its connection string). This is correct, expected behavior for this sub-project, not a bug: how a packaged/installed copy of OMNES gets its real database configuration is a `feature/onboarding` or `feature/settings` concern, out of scope here. The packaging verification task confirms the app **degrades gracefully** (shows "offline", doesn't crash), not that it connects.

All of the tasks below reflect the corrected, verified reality — not the original assumptions.

---

### Task 1: Install Prisma and its driver adapter, create the branch

**Files:**

- Modify: `package.json`
- Create: `pnpm-lock.yaml` (updated)

- [ ] **Step 1: Create the branch**

```bash
git checkout main
git pull
git checkout -b feature/database
```

- [ ] **Step 2: Install dependencies**

```bash
pnpm add @prisma/client @prisma/adapter-pg pg dotenv
pnpm add -D prisma @types/pg
```

- [ ] **Step 3: Add database scripts to package.json**

Add to the `scripts` block:

```json
    "db:generate": "prisma generate",
    "db:migrate": "prisma migrate dev",
    "db:studio": "prisma studio",
    "postinstall": "prisma generate"
```

`postinstall` running `prisma generate` means a fresh `pnpm install` (a new machine, CI, a teammate cloning the repo) always has a working generated client without a manual step — `prisma generate` only reads `prisma/schema.prisma`'s structure, it does not need `DATABASE_URL` to point at a reachable database.

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "Install Prisma with the PostgreSQL driver adapter"
```

---

### Task 2: Prisma schema and config

**Files:**

- Create: `prisma/schema.prisma`
- Create: `prisma.config.ts`
- Modify: `.gitignore`

- [ ] **Step 1: Write prisma/schema.prisma**

```prisma
generator client {
  provider = "prisma-client"
  output   = "../generated/prisma"
}

datasource db {
  provider = "postgresql"
}
```

No models yet, intentionally — see the design spec's "Out of scope" section. No `url` in the datasource block — Prisma 7 resolves the connection string via `prisma.config.ts` for tooling, and via the driver adapter for the application's own runtime `PrismaClient` (Task 6).

- [ ] **Step 2: Write prisma.config.ts**

```typescript
import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
```

This is read by the `prisma` CLI (`generate`, `migrate`, `studio`) — it is not used by the running Electron app itself, which constructs its own `PrismaClient` directly (Task 6).

- [ ] **Step 3: Add the generated client output to .gitignore**

Add `generated/` to `.gitignore` (alongside the existing `node_modules/`, `out/`, `release/` entries) — this is generated code, regenerated by `postinstall`, never committed.

- [ ] **Step 4: Generate the client**

Run: `pnpm db:generate`
Expected:

```
Loaded Prisma config from prisma.config.ts.
Prisma schema loaded from prisma\schema.prisma.
✔ Generated Prisma Client (7.9.1) to .\generated\prisma in <N>ms
```

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma.config.ts .gitignore
git commit -m "Add Prisma schema and config"
```

---

### Task 3: Grant CREATEDB and run the initial migration

**Files:** none (database-side setup + a no-op migration attempt)

- [ ] **Step 1: Grant CREATEDB on the omnes role**

Prisma's `migrate dev` needs to create a temporary shadow database to compute schema diffs. Ask the human operator to run this once (uses the `postgres` superuser password, which must never be typed into any command run on their behalf):

```bash
"C:\Program Files\PostgreSQL\17\bin\psql.exe" -U postgres -c "ALTER ROLE omnes CREATEDB;"
```

- [ ] **Step 2: Run migrate dev**

Run: `pnpm db:migrate -- --name init`
Expected: with the current zero-model schema, Prisma reports `Already in sync, no schema change or pending migration was found.` and creates no migration files. This is correct — there is nothing to migrate yet. Do not try to force an empty migration file into existence; the real proof of connectivity is the health check built in Task 6-7, not a migration artifact.

- [ ] **Step 3: No commit** (nothing was created)

---

### Task 4: Update .env.example

**Files:**

- Modify: `.env.example`

- [ ] **Step 1: Replace the placeholder content**

```
# OMNES environment configuration
# Copy this file to .env and fill in real values. .env is gitignored and
# must never be committed.

# PostgreSQL connection string. Local development expects a database
# already created (see docs/architecture.md for the one-time setup).
DATABASE_URL="postgresql://USER:PASSWORD@localhost:5432/DATABASE_NAME?schema=public"
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "Document DATABASE_URL in .env.example"
```

---

### Task 5: Database connection service

**Files:**

- Create: `electron/main/services/core/database.ts`
- Delete: `electron/main/services/core/.gitkeep` (Foundation placeholder, now has a real file)

- [ ] **Step 1: Write electron/main/services/core/database.ts**

```typescript
import { PrismaPg } from '@prisma/adapter-pg';
import log from 'electron-log/main';
import { PrismaClient } from '../../../../generated/prisma/client';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });

export const prisma = new PrismaClient({ adapter });

export async function checkDatabaseHealth(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch (error) {
    log.error('Database health check failed', error);
    return false;
  }
}

export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
}
```

The relative import path (`../../../../generated/prisma/client`) walks from `electron/main/services/core/` up to the repo root, then into `generated/prisma/client`. This works without a path alias because it's a straightforward relative path within the main process's own tsconfig — no alias was added for `generated/` since only this one file needs it.

- [ ] **Step 2: Remove the placeholder**

```bash
git rm electron/main/services/core/.gitkeep
```

- [ ] **Step 3: Verify typecheck**

Run: `pnpm typecheck`
Expected: zero errors — this is the first real proof the generated client's types resolve correctly.

- [ ] **Step 4: Verify the build bundles cleanly (no native binary issues)**

Run: `pnpm build`
Expected: `out/main/index.js` builds successfully (grows from Foundation's ~2 KB to ~5 KB, reflecting the bundled connection service, adapter, and `pg` driver — all pure JS, confirmed by there being no `.node` files anywhere in `generated/`, `@prisma/adapter-pg`, or `pg`).

- [ ] **Step 5: Commit**

```bash
git add electron/main/services/core/database.ts
git commit -m "Add database connection service using the PostgreSQL driver adapter"
```

---

### Task 6: Wire dotenv into the main process

**Files:**

- Modify: `electron/main/index.ts`

- [ ] **Step 1: Load .env at the very top of the main process entry**

In `electron/main/index.ts`, add as the first import (before everything else, including `electron`):

```typescript
import 'dotenv/config';
```

This is required — Electron does not automatically read `.env` files into `process.env` the way some other tooling does. `prisma.config.ts` loading `dotenv/config` only affects the separate `prisma` CLI process, not the running Electron app. Without this import, `process.env.DATABASE_URL` is `undefined` in the app itself and the health check silently reports "offline" even with a perfectly valid `.env` file sitting right there. `dotenv/config` is silent and harmless if `.env` doesn't exist (e.g. in the packaged app — see the corrections section above).

- [ ] **Step 2: Verify typecheck**

Run: `pnpm typecheck`
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add electron/main/index.ts
git commit -m "Load .env in the main process"
```

---

### Task 7: Health-check IPC channel

**Files:**

- Modify: `shared/ipc.ts`
- Modify: `electron/preload/index.ts`
- Modify: `electron/main/ipc/index.ts`

- [ ] **Step 1: Extend shared/ipc.ts**

```typescript
export const IPC_CHANNELS = {
  getAppVersion: 'app:get-version',
  checkDatabaseHealth: 'database:health-check',
} as const;

export interface DatabaseHealthResult {
  connected: boolean;
}

export interface AppApi {
  getAppVersion: () => Promise<string>;
  checkDatabaseHealth: () => Promise<DatabaseHealthResult>;
}
```

- [ ] **Step 2: Extend electron/preload/index.ts**

```typescript
import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS, type AppApi } from '@shared/ipc';

const api: AppApi = {
  getAppVersion: () => ipcRenderer.invoke(IPC_CHANNELS.getAppVersion),
  checkDatabaseHealth: () => ipcRenderer.invoke(IPC_CHANNELS.checkDatabaseHealth),
};

contextBridge.exposeInMainWorld('omnes', api);
```

- [ ] **Step 3: Extend electron/main/ipc/index.ts**

```typescript
import { app, ipcMain } from 'electron';
import { IPC_CHANNELS, type DatabaseHealthResult } from '@shared/ipc';
import { checkDatabaseHealth } from '../services/core/database';

export function registerIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.getAppVersion, () => app.getVersion());

  ipcMain.handle(IPC_CHANNELS.checkDatabaseHealth, async (): Promise<DatabaseHealthResult> => {
    const connected = await checkDatabaseHealth();
    return { connected };
  });
}
```

- [ ] **Step 4: Verify typecheck**

Run: `pnpm typecheck`
Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add shared/ipc.ts electron/preload/index.ts electron/main/ipc/index.ts
git commit -m "Add database health-check IPC channel"
```

---

### Task 8: Disconnect on app shutdown

**Files:**

- Modify: `electron/main/index.ts`

- [ ] **Step 1: Add the shutdown hook**

Add the import:

```typescript
import { disconnectDatabase } from './services/core/database';
```

And register a handler alongside `app.on('window-all-closed', ...)`:

```typescript
app.on('before-quit', () => {
  disconnectDatabase().catch((error: unknown) => {
    log.error('Failed to disconnect database cleanly', error);
  });
});
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm typecheck`
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add electron/main/index.ts
git commit -m "Disconnect database cleanly on app shutdown"
```

---

### Task 9: Shell UI status indicator

**Files:**

- Modify: `src/locales/en.json`, `src/locales/rw.json`, `src/locales/fr.json`
- Modify: `src/app/AppShell.tsx`
- Modify: `src/app/AppShell.module.css`

- [ ] **Step 1: Replace locale files with their full updated content**

`src/locales/en.json`:

```json
{
  "app.name": "OMNES",
  "shell.loading": "Loading...",
  "shell.comingSoon": "Coming soon",
  "shell.databaseConnected": "Database connected",
  "shell.databaseOffline": "Database offline",
  "modules.core": "Core",
  "modules.pos": "Point of Sale",
  "modules.inventory": "Inventory",
  "modules.crm": "Customers",
  "modules.reports": "Reports",
  "modules.admin": "Administration"
}
```

`src/locales/rw.json`:

```json
{
  "app.name": "OMNES",
  "shell.loading": "Turacyategura...",
  "shell.comingSoon": "Bizaza vuba",
  "shell.databaseConnected": "Ububiko bw'amakuru buhujwe",
  "shell.databaseOffline": "Ububiko bw'amakuru ntibuhuye",
  "modules.core": "Ibanze",
  "modules.pos": "Kugurisha",
  "modules.inventory": "Ububiko",
  "modules.crm": "Abakiriya",
  "modules.reports": "Raporo",
  "modules.admin": "Ubuyobozi"
}
```

`src/locales/fr.json`:

```json
{
  "app.name": "OMNES",
  "shell.loading": "Chargement...",
  "shell.comingSoon": "Bientôt disponible",
  "shell.databaseConnected": "Base de données connectée",
  "shell.databaseOffline": "Base de données hors ligne",
  "modules.core": "Cœur",
  "modules.pos": "Point de vente",
  "modules.inventory": "Inventaire",
  "modules.crm": "Clients",
  "modules.reports": "Rapports",
  "modules.admin": "Administration"
}
```

- [ ] **Step 2: Add state and an effect to AppShell.tsx**

Add alongside the existing `version` state:

```typescript
const [isDatabaseConnected, setIsDatabaseConnected] = useState<boolean | null>(null);
```

Add a second effect, following the exact pattern the version-fetch effect already uses:

```typescript
useEffect(() => {
  let cancelled = false;
  window.omnes
    ?.checkDatabaseHealth()
    .then((result) => {
      if (!cancelled) setIsDatabaseConnected(result.connected);
    })
    .catch((error: unknown) => {
      console.error('Failed to check database health', error);
    });
  return () => {
    cancelled = true;
  };
}, []);
```

Add the badge in the titlebar, after the version span:

```tsx
{
  isDatabaseConnected !== null && (
    <span className={styles.dbStatus} data-connected={isDatabaseConnected}>
      {t(isDatabaseConnected ? 'shell.databaseConnected' : 'shell.databaseOffline')}
    </span>
  );
}
```

- [ ] **Step 3: Add the CSS class**

In `src/app/AppShell.module.css`, add:

```css
.dbStatus {
  color: var(--color-text-secondary);
  font-size: 0.75rem;
}

.dbStatus[data-connected='false'] {
  color: #e5484d;
}
```

(`#e5484d` is a plain red for the offline state — the full semantic color palette, including a proper `--color-danger` token, is designed in the later `feature/themes` sub-project.)

- [ ] **Step 4: Verify typecheck, lint, and existing unit tests**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: zero errors. `AppShell.test.tsx` should still pass unchanged — `window.omnes` is `undefined` in jsdom, so `isDatabaseConnected` stays `null` and the badge doesn't render.

- [ ] **Step 5: Commit**

```bash
git add src/locales src/app/AppShell.tsx src/app/AppShell.module.css
git commit -m "Add database connection status indicator to shell"
```

---

### Task 10: Manual verification of the real connection

**Files:** none (verification only)

- [ ] **Step 1: Build and launch the built app directly**

Run: `pnpm build`, then launch `out/main/index.js` via Playwright's Electron test harness (this is the same technique Foundation used to catch the sandboxed-preload bug — it's more reliable than eyeballing a window, since it can read `window.omnes.checkDatabaseHealth()` directly):

Write a throwaway script (do not commit it), e.g. `debug-db.mjs`:

```javascript
import { _electron as electron } from '@playwright/test';
import path from 'node:path';

const app = await electron.launch({
  args: [path.resolve(process.cwd(), 'out/main/index.js')],
});
const window = await app.firstWindow();
await window.waitForLoadState('domcontentloaded');
await window.waitForTimeout(2000);
const result = await window.evaluate(() => window.omnes.checkDatabaseHealth());
console.log('DB HEALTH RESULT:', JSON.stringify(result));
await app.close();
```

Run: `node debug-db.mjs`
Expected: `DB HEALTH RESULT: {"connected":true}` — a real round trip through IPC, the connection service, the driver adapter, and a live local PostgreSQL query.

- [ ] **Step 2: Delete the throwaway script**

```bash
rm debug-db.mjs
```

Nothing from this task gets committed — it's a verification step, not a deliverable, the same way Foundation's Task 17 (manual dev boot check) wasn't.

---

### Task 11: Packaging sanity check (expect graceful "offline", not a crash)

**Files:** none (verification only)

- [ ] **Step 1: Run the packaging build**

Run: `pnpm package`
Expected: builds successfully. No `asarUnpack` or `files` changes are needed in `electron-builder.yml` — there's no native binary to unpack (see the corrections section above).

- [ ] **Step 2: Launch the packaged app and confirm graceful degradation**

Run: `./release/win-unpacked/OMNES.exe`
Expected: the window opens showing "Database offline" in the titlebar (not "connected" — the packaged app has no `.env`, so `DATABASE_URL` is genuinely unset there) and, critically, does **not crash**. This proves the error-handling path in `checkDatabaseHealth()` works correctly under a real missing-config condition, not just a mocked one. Close the app.

If the packaged app instead crashes or shows "connected" unexpectedly, something is wrong (e.g. `.env` accidentally got bundled) — investigate before proceeding.

---

### Task 12: Extend the Playwright e2e test

**Files:**

- Modify: `tests/e2e/app.spec.ts`

- [ ] **Step 1: Add the database status assertion**

```typescript
import path from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';

test('launches the shell and resolves the app version and database status over IPC', async () => {
  const app = await electron.launch({
    args: [path.resolve(process.cwd(), 'out/main/index.js')],
  });

  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');

  await expect(window).toHaveTitle('OMNES');
  await expect(window.getByText('Core')).toBeVisible();
  await expect(window.getByText(/^v\d+\.\d+\.\d+$/)).toBeVisible();
  await expect(window.getByText(/^Database (connected|offline)$/)).toBeVisible({ timeout: 10_000 });

  await app.close();
});
```

Unlike the manual verification in Task 10, this test asserts either "Database connected" or "Database offline" is shown — not specifically "connected" — because whether a `.env` with a real `DATABASE_URL` is present depends on the environment running the test (a developer's machine with `.env` set up vs. a fresh CI checkout before Task 13 adds a CI database). The meaningful assertion is that the IPC round trip completes and renders _some_ real result, not a specific one. Task 13 makes "connected" the guaranteed CI outcome by provisioning a real database there.

- [ ] **Step 2: Run the e2e test**

Run: `pnpm test:e2e`
Expected: PASS, against the real local `omnes_dev` database (should show "connected" on this machine, matching Task 10's verification).

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/app.spec.ts
git commit -m "Extend e2e test to verify database status renders"
```

---

### Task 13: Add PostgreSQL service container to CI

**Files:**

- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Update .github/workflows/ci.yml**

```yaml
name: CI

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:17
        env:
          POSTGRES_USER: omnes
          POSTGRES_PASSWORD: omnes_ci_password
          POSTGRES_DB: omnes_test
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    env:
      DATABASE_URL: postgresql://omnes:omnes_ci_password@localhost:5432/omnes_test?schema=public
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 9

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm

      - run: pnpm install --frozen-lockfile

      - run: pnpm lint

      - run: pnpm typecheck

      - run: pnpm test

      - run: pnpm build

      - run: pnpm exec playwright test
```

Two changes beyond adding Postgres: the runner switches from `windows-latest` to `ubuntu-latest` (GitHub Actions service containers are a Linux-runner-only feature), and `DATABASE_URL` is set as a job-level env var pointing at the service container — no `.env` file needed in CI since the app reads directly from `process.env`, which GitHub Actions populates from the `env:` block for every step. `omnes_ci_password` is not a real secret — a throwaway credential for a container that only exists for one CI run.

No `prisma migrate deploy` step is included — there are no migration files yet (Task 3 confirmed zero models means zero migrations). Add that step when the first real migration exists.

Switching to `ubuntu-latest` means Task 11's Windows-specific `pnpm package` verification does NOT run in CI — that stays a manual step, consistent with how Foundation scoped packaging as sanity-only, not CI-gated.

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "Add PostgreSQL service container to CI and run e2e tests"
```

---

### Task 14: Final integration check

**Files:** none (verification only)

- [ ] **Step 1: Run the full local verification suite**

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm package
```

Expected: every command exits 0, against the real local PostgreSQL database (the last one, `pnpm package`, is verified per Task 11 — expect "offline" there, not a failure).

- [ ] **Step 2: Push the branch**

```bash
git push -u origin feature/database
```

- [ ] **Step 3: Hand off for integration**

Use the `superpowers:finishing-a-development-branch` skill to decide how `feature/database` gets merged into `main`.
