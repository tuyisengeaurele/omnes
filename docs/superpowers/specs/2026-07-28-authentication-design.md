# Authentication — Design

Status: Approved
Date: 2026-07-28

## Purpose

OMNES needs local, fully offline authentication before any real business
module (POS, inventory, CRM) can be built on top of it — every action needs
an acting user and a role to check permissions against later. This
sub-project adds login, password hashing, role-based sessions, inactivity
auto-lock, and audit logging. It does not add granular permission
management (that's `feature/roles`), a full first-run setup wizard (that's
`feature/onboarding`), or user management CRUD (that's `feature/users`) —
it adds just enough to get one real, working login screen with a real
database-backed user, plus the seam those later branches build on.

Success criteria: a fresh database with zero users shows a "create the
first admin account" form instead of login; a created user can log in with
a real bcrypt-verified password; the shell is inaccessible until
authenticated; after 5 minutes of real OS-level inactivity the app shows a
lock screen requiring the current user's password to resume (not a full
logout); every login attempt (success and failure), logout, lock, and
unlock is recorded in a real `AuditLog` table.

## Architecture

```
prisma/schema.prisma          # + User, Role enum, AuditLog models
electron/main/services/core/
├── auth.ts                    # login, createFirstAdmin, session state, audit logging
└── idle.ts                    # powerMonitor-based inactivity → lock event
electron/main/ipc/index.ts      # + auth:login, auth:create-first-admin, auth:logout,
                                 #   auth:unlock, auth:get-session, auth:has-users
shared/ipc.ts                   # + auth channel types, Session/User (safe, no password) types
src/modules/core/
├── LoginScreen.tsx             # login form (React Hook Form + Zod)
├── CreateFirstAdminScreen.tsx  # shown only when zero users exist
└── LockScreen.tsx              # shown after inactivity auto-lock
src/app/
├── AuthGate.tsx                 # decides which of the above vs. AppShell to render
└── App.tsx                      # + AuthGate wraps the router
src/lib/
└── store/authStore.ts           # Zustand: current session, lock state
```

## Components

- **Password hashing** (`auth.ts`): `bcryptjs`, cost factor 12. Chosen over
  native `bcrypt`/`argon2` specifically to avoid reintroducing native-binary
  Electron packaging complexity — Database Foundation already proved a
  fully pure-JS dependency chain packages cleanly, and this preserves that.
- **User bootstrap**: `hasUsers()` (a plain `prisma.user.count() > 0` check)
  gates the renderer between `CreateFirstAdminScreen` and `LoginScreen`.
  `createFirstAdmin(username, password)` only succeeds when the user table
  is genuinely empty (checked again server-side at call time, not trusted
  from the renderer) — always creates role `ADMIN`.
- **Session**: held as plain in-memory main-process state (current
  `{ userId, username, role, loginAt }` or `null`), not a token — since the
  renderer already can't reach the database or main-process state directly
  except through IPC, there's no separate token/cookie boundary to defend
  the way a web app would need. `auth:get-session` lets the renderer ask
  "am I logged in, as whom" on boot (e.g. after a dev-mode reload).
- **Auto-lock** (`idle.ts`): polls `powerMonitor.getSystemIdleTime()` every
  30 seconds; when it exceeds 300 seconds (5 minutes) and a session is
  active and not already locked, marks the session locked and pushes a
  `session:locked` event to the renderer over IPC (not a request/response
  channel — this one is main-initiated). `LockScreen` requires the current
  user's password to clear the locked flag (`auth:unlock`) — it does not
  destroy the session, just gates the UI.
- **Renderer routing** (`AuthGate.tsx`): replaces `App.tsx`'s previous
  direct render of the shell. On mount, calls `auth:has-users` and
  `auth:get-session`; renders `CreateFirstAdminScreen` (no users),
  `LoginScreen` (users exist, no session), `LockScreen` (session exists but
  locked), or the existing `AppShell`/`Dashboard` router (session exists,
  unlocked) — in that priority order.
- **"Remember user"**: `electron-store` persists only the last successfully
  logged-in username (a `Store` instance in the main process, read once to
  pre-fill `LoginScreen`'s username field via IPC) — never a password,
  never a token.
- **Audit log**: every `AuditLog` write happens inside `auth.ts` alongside
  the action it's recording (e.g. `login()` always writes exactly one
  `login_success` or `login_failure` row before returning), so there's no
  separate "remember to log this" step that can be forgotten by a future
  caller.

## Data flow

`LoginScreen` submit → `auth:login(username, password)` IPC → `auth.ts`
looks up the user, `bcrypt.compare`s the password, writes an `AuditLog`
row, and on success sets the in-memory session and returns a safe user
object (no `passwordHash` field ever crosses IPC) → renderer's
`authStore` updates → `AuthGate` re-renders to the shell.

Idle detection is main-initiated: `idle.ts`'s timer → session marked
locked → `session:locked` pushed to renderer → `authStore` updates →
`AuthGate` swaps to `LockScreen`, independent of any renderer action.

## Error handling

- `auth:login` never distinguishes "user doesn't exist" from "wrong
  password" in its renderer-facing error — both return a generic
  "Invalid username or password" so the login form can't be used to
  enumerate valid usernames. The audit log still records which case
  occurred internally (`login_failure` either way, with a reason in a
  short internal log message, not exposed to the renderer).
- `auth:create-first-admin` re-validates zero-users server-side; if a user
  now exists (e.g. a race from two windows, or a stale renderer), it
  rejects rather than silently creating a second admin unexpectedly.
- Idle-lock and unlock failures are logged via electron-log; a failed
  unlock attempt keeps the lock screen up and does not log an audit event
  for the attempt itself beyond what `auth:login`-style rate limiting would
  need — full lockout/rate-limiting after N failed attempts is not in scope
  for this sub-project (flagged as a `feature/security` follow-up, not
  silently skipped).

## Testing

- Unit tests for the password hashing round trip and for `auth.ts`'s
  login logic against a real (test) database connection, following the
  same "test what has real logic" principle as Foundation and Database
  Foundation — no tests for pure UI layout.
- Playwright e2e test extended: launch the packaged app against a freshly
  migrated, empty test database, confirm `CreateFirstAdminScreen` renders,
  create an admin, confirm it lands on the shell — this is the first e2e
  test that exercises a real multi-step user flow rather than a single
  IPC round trip.

## Out of scope for this sub-project

Granular permission management UI (`feature/roles`), full onboarding
wizard (`feature/onboarding`), user management CRUD beyond the one
first-admin bootstrap (`feature/users`), password reset/forgot-password
(no email service exists), 2FA, configurable lock timeout (hardcoded 5
minutes for now), login rate-limiting/lockout after repeated failures
(`feature/security` follow-up).

## Git workflow

- Branch: `feature/authentication`, off `main`.
- Multiple small commits: schema → password hashing service → session/audit
  service → idle/lock service → IPC wiring → renderer screens → AuthGate
  wiring → tests → CI (if the migration needs deploying in CI, add that
  step here since this is the first sub-project with real migrations).
- Merge to `main` via PR once verified locally and in CI.
