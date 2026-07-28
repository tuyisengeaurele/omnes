# Database Foundation — Design

Status: Approved
Date: 2026-07-28

## Purpose

Every future OMNES module (auth, POS, inventory, CRM, reports, admin) needs
persistent storage. This sub-project establishes the database connectivity
layer — Prisma wired to a local PostgreSQL instance, a connection service
in the main process, and the schema conventions every later module will
follow — without defining any business tables itself. Business schemas
belong to the module that needs them, added when that module is built.

Success criteria: the app connects to PostgreSQL on startup, a real
health-check round-trips through IPC and renders in the shell UI, the
connection is cleanly closed on app shutdown, and the packaged
(electron-builder) build still works with Prisma's native query engine
binary correctly unpacked from asar.

## Architecture

```
prisma/
└── schema.prisma          # datasource + generator only, zero models
electron/main/services/core/
└── database.ts            # PrismaClient singleton, connect/disconnect/healthCheck
electron/main/ipc/
└── index.ts                # + database:health-check handler
shared/
└── ipc.ts                  # + DATABASE_HEALTH_CHECK channel, HealthCheckResult type
src/app/
└── AppShell.tsx             # + "DB: connected/offline" indicator next to version badge
.env.example                 # + DATABASE_URL placeholder (non-secret)
electron-builder.yml          # + asarUnpack for @prisma/.prisma native engine
```

## Components

- **Prisma schema**: `datasource db { provider = "postgresql", url =
env("DATABASE_URL") }` plus the client generator. No models yet — this is
  intentional, not incomplete. `prisma migrate dev --name init` still
  produces a real, verifiable artifact (Prisma's own `_prisma_migrations`
  tracking table) proving the pipeline works end to end.
- **Connection service** (`electron/main/services/core/database.ts`): a
  single `PrismaClient` instance created at module load, a `healthCheck()`
  function running `SELECT 1` via `$queryRaw`, and a `disconnect()` called
  from the main process's shutdown handlers (`before-quit`).
- **IPC**: `shared/ipc.ts` gains a `database:health-check` channel returning
  `{ connected: boolean }` (no error details leaked to the renderer — the
  real error, if any, is logged via electron-log in the main process only).
  This follows the exact pattern Foundation established with
  `app:get-version`.
- **Shell indicator**: `AppShell.tsx`'s titlebar gains a small status badge
  next to the version badge, fetched the same way (`useEffect` +
  `window.omnes.checkDatabaseHealth()`), showing "DB: connected" or "DB:
  offline" — real signal, not decoration, and gives the e2e test a second
  IPC round-trip to assert on.
- **Packaging**: Prisma's query engine is a native binary and cannot
  execute from inside an asar archive. `electron-builder.yml` needs
  `asarUnpack` entries for `node_modules/@prisma/**` and
  `node_modules/.prisma/**`. This is verified, not assumed — the packaging
  sanity build (`pnpm package`) is re-run at the end of this sub-project
  and the packaged app is launched to confirm the database connection
  still works outside of dev mode.

## Data flow

Renderer → `window.omnes.checkDatabaseHealth()` → preload → IPC →
`electron:main/ipc` handler → `database.ts`'s `healthCheck()` → Prisma →
PostgreSQL → `SELECT 1` → result flows back up the same chain. No business
data flows anywhere yet.

## Error handling

- Connection failures at startup are logged via electron-log (already
  wired in Foundation) rather than crashing the app — a missing or
  unreachable database should degrade to a visible "DB: offline" indicator,
  not an unhandled exception, since a shop's local Postgres service being
  stopped is a real, recoverable condition a cashier needs to see, not a
  crash.
- The health-check IPC handler catches and logs the Prisma error itself,
  returning `{ connected: false }` to the renderer rather than throwing
  across the IPC boundary.

## Testing

- No new unit-testable business logic yet (the connection service is thin
  wiring around Prisma, not independently mockable in a way that's worth
  testing at this stage).
- The existing Playwright e2e smoke test gains an additional assertion:
  after the app launches, the "DB: connected" indicator becomes visible,
  proving the full stack (main process → Prisma → real local PostgreSQL)
  actually works, not just that it typechecks.
- Manual verification: `pnpm dev` boot check (as in Foundation), plus a
  repeat of the `pnpm package` sanity build to catch the asar/native-binary
  issue before it becomes a hidden problem in a later, more complex
  packaging sub-project.

## Out of scope for this sub-project

Any business schema (Users, Products, Sales, Customers, ...), migrations
beyond the initial empty one, seed data, backup/restore (that's
`feature/backup`), connection pooling tuning, multi-terminal considerations.
Each gets addressed when the module that needs it is built.

## Git workflow

- Branch: `feature/database`, off `main` (which now includes the merged
  Foundation).
- Multiple small commits: Prisma install + schema → connection service →
  IPC wiring → shell indicator → electron-builder asarUnpack fix → e2e
  assertion update → packaging re-verification.
- Merge to `main` via PR once the shell boots, connects to the real local
  PostgreSQL instance, and the packaged build is re-verified.
