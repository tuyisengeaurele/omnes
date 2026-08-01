# Backup — Design

Status: Approved
Date: 2026-07-31

## Purpose

OMNES holds a shop's sales, inventory, and customer data in a local
PostgreSQL database with no cloud dependency — losing that database means
losing the business's records entirely. This sub-project adds local,
`pg_dump`-based backup, restore, verification, and scheduling, per the
master brief's Backup section. It is also the first sub-project to give
the "Administration" sidebar entry real content (currently a disabled
placeholder since Foundation) — a backup history screen, since restore is
destructive enough to need a real confirmation flow, not a titlebar badge
like Database Foundation's or Licensing's single status indicators.

Success criteria: a manual backup produces a real, compressed `pg_dump`
archive on disk; that archive can be independently verified by actually
restoring it into a throwaway database (not just checking it parses);
restoring a chosen backup replaces the current database's contents after
an explicit, typed confirmation; and if the most recent successful backup
is more than 24 hours old, one is taken automatically without user action.

## Architecture

```
electron/main/services/core/
├── backup.ts                # pure-ish: spawn pg_dump/pg_restore, parse results
├── backup-store.ts           # electron-store: backup history metadata
└── backup-scheduler.ts       # setInterval "is a backup due" check, matches idle.ts
electron/main/ipc/
└── index.ts                   # + backup:create, backup:list, backup:verify,
                                #   backup:restore, backup:reveal-in-folder
shared/
└── ipc.ts                     # + BackupRecord, BackupResult types
src/modules/admin/
├── BackupPanel.tsx             # backup history, "Back up now", restore w/ confirmation
└── AdminPage.tsx                # thin wrapper, becomes AppShell's Administration route
src/app/
├── AppShell.tsx                 # Administration nav item: enabled: false → true
```

## Components

- **`backup.ts`**: locates `pg_dump`/`pg_restore` (tries `PATH` first via
  spawning `pg_dump --version`; on failure, checks a short list of common
  OS install directories — e.g. `C:\Program Files\PostgreSQL\*\bin` on
  Windows — and caches whichever path resolves for the process lifetime).
  `createBackup()` spawns `pg_dump -Fc` writing to a timestamped file in
  the backups directory, using `DATABASE_URL` for connection info (parsed
  into discrete `pg_dump` arguments — env vars aren't reliably inherited
  the same way across `child_process.spawn` on every platform, so this is
  explicit, not assumed). `verifyBackup(filePath)` creates a throwaway
  `omnes_backup_verify` database, `pg_restore`s the file into it, checks
  the process exit code, then drops the database regardless of outcome
  (in a `finally`, so a failed restore doesn't leave the scratch database
  behind). `restoreBackup(filePath)` runs `pg_restore --clean --if-exists`
  against the real `omnes_dev` database — before doing so, the IPC handler
  must disconnect Prisma's connection pool first (`prisma.$disconnect()`),
  since Postgres can't drop objects with an active session holding them.
  The main process reconnects automatically afterward — Prisma's client
  lazily opens a new connection on its next query, so nothing explicit is
  needed to resume normal operation once `pg_restore` finishes.
- **`backup-store.ts`**: `electron-store`-backed history — an array of
  `{ id, filename, createdAt, sizeBytes, verified, verifiedAt }` records,
  persisted outside Postgres deliberately: if the database is ever lost or
  a restore replaces its contents, the record of what backups exist and
  when they were last verified must survive that, not be part of what
  gets restored over.
- **`backup-scheduler.ts`**: the same `setInterval`-based "is this due"
  pattern as `idle.ts` — checks backup history on startup and every few
  hours while running; if the newest successful backup is missing or
  older than 24 hours, calls `createBackup()` in the background and logs
  the result via electron-log (success or failure), without blocking or
  interrupting whatever the user is doing.
- **IPC**: `backup:create`, `backup:list`, `backup:verify` (re-verify an
  existing backup on demand), `backup:restore`, and
  `backup:reveal-in-folder` (opens the OS file manager at the backups
  directory via `shell.showItemInFolder`) — all thin wrappers over
  `backup.ts`/`backup-store.ts`, following the same handler pattern as
  every prior sub-project's IPC surface.
- **UI**: `AppShell`'s `MODULE_NAV` gets `modules.admin`'s `enabled` flipped
  to `true`, with a route added for it. `BackupPanel` lists backup history
  (timestamp, size, verified/not, verified-at), a "Back up now" button
  that calls `backup:create` and refreshes the list, and a "Restore" action
  per entry that requires typing the word `RESTORE` into a confirmation
  input before it's enabled — restoring silently replacing a shop's live
  sales data is exactly the kind of action that needs friction, not a
  single click.

## Data flow

Manual backup: `BackupPanel` → `backup:create` IPC → `backup.ts` spawns
`pg_dump -Fc` → on success, `backup-store.ts` appends a record → the
renderer refetches `backup:list` and re-renders. Restore: `BackupPanel`
(after typed confirmation) → `backup:restore` IPC → main process
disconnects Prisma → `pg_restore --clean --if-exists` → main process's
next database access reconnects automatically. Scheduled: `backup-
scheduler.ts`'s timer → same `createBackup()` path as manual, no renderer
involvement unless the app happens to be open and later requests
`backup:list`.

## Error handling

- A failed `pg_dump`/`pg_restore` (non-zero exit code, binary not found)
  is logged via electron-log with the captured stderr, and the IPC caller
  gets a clean `{ success: false, message }` — never a raw child-process
  error object crossing the IPC boundary.
- `verifyBackup`'s scratch database is dropped in a `finally` block
  regardless of whether the restore into it succeeded, so a failed
  verification never leaves an orphaned `omnes_backup_verify` database
  behind to confuse a later verification attempt.
- If `pg_dump`/`pg_restore` can't be located at all (neither `PATH` nor
  the fallback directories), `backup:create`/`backup:restore`/
  `backup:verify` all return a clear "PostgreSQL command-line tools not
  found" error rather than a confusing spawn `ENOENT`.

## Testing

- Given a real local PostgreSQL install is already a hard requirement for
  this entire project (Database Foundation onward), and `pg_dump`/
  `pg_restore` ship with it, unit tests for `backup.ts` run the real
  binaries against the real local database — creating an actual backup
  file in a temp directory, then actually verifying it via the real
  restore-into-scratch-database path, then cleaning up. This matches the
  project's established "test real behavior, not mocks" philosophy
  (`auth.test.ts`, `license.test.ts`, `database.ts`'s own health check)
  rather than mocking `child_process.spawn`, which would only prove the
  code calls a function, not that backups actually work.
- `backup-scheduler.ts`'s "is a backup due" logic (a pure date comparison)
  is tested in isolation without needing a real backup to exist.
- Manual verification: take a real backup, make an observable change to
  the database (e.g. via the existing `auth.ts` test helpers or a quick
  direct insert), restore the backup, confirm the change is gone —
  proving restore actually reverts real data, not just that the command
  exits 0.
- e2e: the Administration nav item becomes reachable and `BackupPanel`
  renders with a real "Back up now" round trip, following the same
  pattern as every prior sub-project's UI addition.

## Out of scope for this sub-project

Backup encryption at rest (the master brief doesn't call for it, and
these files already live inside the OS-protected userData directory —
revisit if compliance requirements demand it later), off-site/cloud backup
copies (explicitly local-only per the brief), a backup-retention/pruning
policy (old backups accumulate indefinitely for now — revisit once real
disk-usage patterns from actual use exist to design against), a
full-featured Administration module beyond this one backup screen
(everything else Administration eventually needs — users, roles,
settings — is its own future sub-project).

## Git workflow

- Branch: `feature/backup`, off `main`.
- Multiple small commits: pg_dump/pg_restore binary discovery → backup.ts
  create/verify/restore + tests → backup-store.ts → scheduler → IPC →
  Administration route + BackupPanel → manual restore verification → e2e.
- Merge to `main` via PR once verified locally and in CI.
