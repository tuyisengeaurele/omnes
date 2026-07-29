# Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Local, offline login with role-based sessions, inactivity auto-lock, and audit logging — the first sub-project with a real Prisma schema (User, AuditLog) and the first real migration.

**Architecture:** `electron/main/services/core/auth.ts` is pure Node/Prisma logic (no Electron imports), unit-testable directly against the real local database. `idle.ts` and `preferences.ts` are thin Electron-API wrappers around it (`powerMonitor`, `electron-store`) that aren't unit tested, matching how Foundation and Database Foundation scoped their own thin main-process wiring. The renderer gates everything behind `AuthGate`, which renders `CreateFirstAdminScreen` / `LoginScreen` / `LockScreen` / the existing shell depending on auth state held in a new Zustand `authStore`.

**Tech Stack:** `bcryptjs` (pure JS password hashing — deliberately not native `bcrypt`/`argon2`, to preserve the fully-native-binary-free Electron packaging Database Foundation established), `react-hook-form` + `zod` + `@hookform/resolvers` (first real use, deferred since Foundation), `electron-store` (first real use), Electron's `powerMonitor` for real OS-level idle detection.

**Note on this plan's granularity:** this is a bigger sub-project than Foundation or Database Foundation — a real schema, a real service with real unit tests, three new screens, and a cross-cutting UI gate. Tasks are still bite-sized, but there are more of them. Follow the same discipline as the prior two plans: verify each step for real, update this plan's own text if reality surprises you (it did twice already, for the preload CJS issue and the Prisma 7 architecture — there is no reason to expect this sub-project won't surface its own surprises).

---

### Task 1: Install dependencies and create the branch

**Files:**

- Modify: `package.json`
- Create: `pnpm-lock.yaml` (updated)

- [ ] **Step 1: Create the branch**

```bash
git checkout main
git pull
git checkout -b feature/authentication
```

- [ ] **Step 2: Install dependencies**

```bash
pnpm add bcryptjs react-hook-form zod @hookform/resolvers electron-store
```

No `@types/bcryptjs` — `bcryptjs` ships its own type definitions; installing the separate `@types` package produces a deprecation warning and isn't needed (found by actually running the install, not assumed).

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "Install authentication dependencies"
```

---

### Task 2: Prisma schema — User, Role, AuditLog

**Files:**

- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add the enums and models**

Append to `prisma/schema.prisma` (after the existing `datasource` block):

```prisma
enum Role {
  ADMIN
  MANAGER
  CASHIER
}

enum AuditAction {
  LOGIN_SUCCESS
  LOGIN_FAILURE
  LOGOUT
  LOCK
  UNLOCK
  ADMIN_CREATED
}

model User {
  id           String   @id @default(uuid())
  username     String   @unique
  passwordHash String
  role         Role
  isActive     Boolean  @default(true)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  auditLogs AuditLog[]
}

model AuditLog {
  id        String      @id @default(uuid())
  userId    String?
  username  String?
  action    AuditAction
  createdAt DateTime    @default(now())

  user User? @relation(fields: [userId], references: [id], onDelete: SetNull)
}
```

`AuditLog.userId` is nullable and the relation uses `onDelete: SetNull` deliberately — a failed login attempt with an unknown username has no user to attach, and if a user account is ever deleted in the future (`feature/users`), its audit history should survive with `userId` cleared rather than being deleted along with it. `username` is stored redundantly on `AuditLog` for the same reason: it stays readable even after the user relation is gone.

- [ ] **Step 2: Regenerate the client and run the migration**

```bash
pnpm db:generate
pnpm exec prisma migrate dev --name add_users_and_audit_log
```

Use `pnpm exec prisma migrate dev --name ...` directly, **not** `pnpm db:migrate -- --name ...`. The latter was tried first and hung indefinitely: `pnpm run <script> -- <args>` on this pnpm version passes the literal `--` token through into the underlying command instead of stripping it as a separator, so `prisma` never saw a recognized `--name` flag, silently fell back to its interactive "Enter a name for the new migration" prompt, and sat there forever waiting on stdin that a non-interactive shell never provides — it doesn't error, it just hangs, which is what makes it worth calling out explicitly here rather than letting the next person rediscover it by waiting several minutes on a stuck command.

Expected: unlike Database Foundation's empty-schema migration, this one produces real output — `prisma/migrations/<timestamp>_add_users_and_audit_log/migration.sql` with `CREATE TYPE`, `CREATE TABLE` statements for `User` and `AuditLog`, plus the `_prisma_migrations` tracking table. This is the project's first real migration file.

- [ ] **Step 3: Verify typecheck**

Run: `pnpm typecheck`
Expected: zero errors — confirms the regenerated Prisma client's `User`/`AuditLog`/`Role`/`AuditAction` types resolve.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "Add User and AuditLog models"
```

---

### Task 3: Shared IPC types for authentication

**Files:**

- Modify: `shared/ipc.ts`

- [ ] **Step 1: Replace shared/ipc.ts with its full updated content**

```typescript
export const IPC_CHANNELS = {
  getAppVersion: 'app:get-version',
  checkDatabaseHealth: 'database:health-check',
  hasUsers: 'auth:has-users',
  createFirstAdmin: 'auth:create-first-admin',
  login: 'auth:login',
  logout: 'auth:logout',
  unlock: 'auth:unlock',
  getSession: 'auth:get-session',
  getLastUsername: 'auth:get-last-username',
  sessionLocked: 'session:locked',
} as const;

export interface DatabaseHealthResult {
  connected: boolean;
}

export type Role = 'ADMIN' | 'MANAGER' | 'CASHIER';

export interface Session {
  userId: string;
  username: string;
  role: Role;
  loginAt: string;
  isLocked: boolean;
}

export interface AppApi {
  getAppVersion: () => Promise<string>;
  checkDatabaseHealth: () => Promise<DatabaseHealthResult>;
  hasUsers: () => Promise<boolean>;
  createFirstAdmin: (username: string, password: string) => Promise<Session>;
  login: (username: string, password: string) => Promise<Session>;
  logout: () => Promise<void>;
  unlock: (password: string) => Promise<Session>;
  getSession: () => Promise<Session | null>;
  getLastUsername: () => Promise<string | null>;
  onSessionLocked: (callback: () => void) => () => void;
}
```

`Role` and `Session` are defined independently here rather than imported from the generated Prisma client — `shared/` is consumed by the renderer bundle too, and Prisma's generated enums are real runtime values, not just types; importing them here would pull Prisma/`pg` internals into the renderer bundle. The string literal values match the schema's `Role` enum exactly, so passing a Prisma `Role` value where this `Role` type is expected works via normal TypeScript structural typing, no casting needed.

`onSessionLocked` is a different shape from every other `AppApi` method — it's a subscription (main-initiated push), not a request/response call. It takes a callback and returns an unsubscribe function, matching the one safe way to expose `ipcRenderer.on` through `contextBridge` without exposing the raw `ipcRenderer` object (which would let renderer code listen to arbitrary channels).

- [ ] **Step 2: Verify typecheck**

Run: `pnpm typecheck`
Expected: fails at this point, since `electron/preload/index.ts` and `electron/main/ipc/index.ts` don't implement the new `AppApi` members yet — that's expected, fixed in Task 7. Confirm the failure is specifically about missing implementations, not a syntax error in this file.

- [ ] **Step 3: Commit**

```bash
git add shared/ipc.ts
git commit -m "Add authentication types to the shared IPC contract"
```

---

### Task 4: Authentication service, with real unit tests (TDD)

**Files:**

- Modify: `tests/unit/setup.ts`
- Create: `tests/unit/auth.test.ts`
- Create: `electron/main/services/core/auth.ts`

- [ ] **Step 1: Load .env into the test environment**

`tests/unit/setup.ts` currently only loads Testing Library's jest-dom matchers. This task's tests connect to the real database via `DATABASE_URL`, and unlike the main process (which loads `dotenv/config` itself in `electron/main/index.ts`), Vitest does not load `.env` automatically — importing `database.ts` in a test without this would try to connect with `DATABASE_URL` undefined and fail. Add it once, here, so every test file benefits:

```typescript
import 'dotenv/config';
import '@testing-library/jest-dom/vitest';
```

Verify: `pnpm test` (no new test files yet) still passes — this only proves the setup file itself doesn't error, real proof comes once `auth.test.ts` exists in Step 4 below.

- [ ] **Step 2: Write the failing tests**

```typescript
// @vitest-environment node
// This file talks to the real local PostgreSQL database (via the same
// Prisma client the app uses) and deletes all User rows before and after
// every test to get a known-empty starting state. It assumes exclusive
// access to the User table while running — don't run it concurrently with
// anything else that touches User rows in the same database.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../electron/main/services/core/database';
import {
  createFirstAdmin,
  getSession,
  hasUsers,
  login,
  logout,
} from '../../electron/main/services/core/auth';

const TEST_USERNAME = '__test_admin__';
const TEST_PASSWORD = 'correct-horse-battery-staple';

async function clearUsers(): Promise<void> {
  await prisma.user.deleteMany();
}

describe('auth', () => {
  beforeEach(async () => {
    await clearUsers();
  });

  afterEach(async () => {
    await clearUsers();
  });

  it('reports no users on an empty table', async () => {
    expect(await hasUsers()).toBe(false);
  });

  it('creates the first admin and starts a session', async () => {
    const session = await createFirstAdmin(TEST_USERNAME, TEST_PASSWORD);

    expect(session.username).toBe(TEST_USERNAME);
    expect(session.role).toBe('ADMIN');
    expect(session.isLocked).toBe(false);
    expect(await hasUsers()).toBe(true);
  });

  it('refuses to create a second first-admin once one exists', async () => {
    await createFirstAdmin(TEST_USERNAME, TEST_PASSWORD);

    await expect(createFirstAdmin('someone-else', TEST_PASSWORD)).rejects.toThrow();
  });

  it('logs in with correct credentials', async () => {
    await createFirstAdmin(TEST_USERNAME, TEST_PASSWORD);
    await logout();

    const session = await login(TEST_USERNAME, TEST_PASSWORD);

    expect(session.username).toBe(TEST_USERNAME);
    expect(getSession()?.username).toBe(TEST_USERNAME);
  });

  it('rejects an incorrect password with a generic error', async () => {
    await createFirstAdmin(TEST_USERNAME, TEST_PASSWORD);
    await logout();

    await expect(login(TEST_USERNAME, 'wrong-password')).rejects.toThrow(
      'Invalid username or password',
    );
  });

  it('rejects a username that does not exist with the same generic error', async () => {
    await expect(login('nobody', TEST_PASSWORD)).rejects.toThrow('Invalid username or password');
  });

  it('clears the session on logout', async () => {
    await createFirstAdmin(TEST_USERNAME, TEST_PASSWORD);
    await logout();

    expect(getSession()).toBeNull();
  });
});
```

The `// @vitest-environment node` comment on line 1 overrides the project's default jsdom environment for this file specifically — this test exercises Node/Prisma logic, not DOM logic, and forcing `node` avoids any risk of jsdom's globals interfering with the database driver.

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm test`
Expected: FAIL — `Cannot find module '../../electron/main/services/core/auth'`.

- [ ] **Step 4: Write electron/main/services/core/auth.ts**

```typescript
import bcrypt from 'bcryptjs';
import { prisma } from './database';
import type { Role, Session } from '@shared/ipc';

const SALT_ROUNDS = 12;
const INVALID_CREDENTIALS_MESSAGE = 'Invalid username or password';

let currentSession: Session | null = null;

function toSession(user: { id: string; username: string; role: Role }): Session {
  return {
    userId: user.id,
    username: user.username,
    role: user.role,
    loginAt: new Date().toISOString(),
    isLocked: false,
  };
}

export async function hasUsers(): Promise<boolean> {
  const count = await prisma.user.count();
  return count > 0;
}

export async function createFirstAdmin(username: string, password: string): Promise<Session> {
  const existingCount = await prisma.user.count();
  if (existingCount > 0) {
    throw new Error('An account already exists');
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const user = await prisma.user.create({
    data: { username, passwordHash, role: 'ADMIN' },
  });

  await prisma.auditLog.create({
    data: { userId: user.id, username: user.username, action: 'ADMIN_CREATED' },
  });

  currentSession = toSession(user);
  return currentSession;
}

export async function login(username: string, password: string): Promise<Session> {
  const user = await prisma.user.findUnique({ where: { username } });

  if (!user || !user.isActive) {
    await prisma.auditLog.create({
      data: { username, action: 'LOGIN_FAILURE' },
    });
    throw new Error(INVALID_CREDENTIALS_MESSAGE);
  }

  const passwordMatches = await bcrypt.compare(password, user.passwordHash);
  if (!passwordMatches) {
    await prisma.auditLog.create({
      data: { userId: user.id, username: user.username, action: 'LOGIN_FAILURE' },
    });
    throw new Error(INVALID_CREDENTIALS_MESSAGE);
  }

  await prisma.auditLog.create({
    data: { userId: user.id, username: user.username, action: 'LOGIN_SUCCESS' },
  });

  currentSession = toSession(user);
  return currentSession;
}

export async function logout(): Promise<void> {
  if (!currentSession) return;

  await prisma.auditLog.create({
    data: { userId: currentSession.userId, username: currentSession.username, action: 'LOGOUT' },
  });

  currentSession = null;
}

export function getSession(): Session | null {
  return currentSession;
}

export async function lockSession(): Promise<void> {
  if (!currentSession || currentSession.isLocked) return;

  currentSession = { ...currentSession, isLocked: true };

  await prisma.auditLog.create({
    data: { userId: currentSession.userId, username: currentSession.username, action: 'LOCK' },
  });
}

export async function unlock(password: string): Promise<Session> {
  if (!currentSession) {
    throw new Error('No active session to unlock');
  }

  const user = await prisma.user.findUnique({ where: { id: currentSession.userId } });
  if (!user) {
    throw new Error(INVALID_CREDENTIALS_MESSAGE);
  }

  const passwordMatches = await bcrypt.compare(password, user.passwordHash);
  if (!passwordMatches) {
    throw new Error(INVALID_CREDENTIALS_MESSAGE);
  }

  currentSession = { ...currentSession, isLocked: false };

  await prisma.auditLog.create({
    data: { userId: user.id, username: user.username, action: 'UNLOCK' },
  });

  return currentSession;
}
```

Note this file imports nothing from `electron` — only `bcryptjs`, the local `database.ts` (Prisma client), and shared types. That's deliberate: it's what makes it possible to unit test with plain `vitest` instead of needing a real Electron runtime.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test`
Expected: PASS — all 7 new `auth` tests, plus the pre-existing `cn` and `AppShell` tests.

- [ ] **Step 6: Verify typecheck**

Run: `pnpm typecheck`
Expected: zero errors.

- [ ] **Step 7: Commit**

```bash
git add tests/unit/setup.ts tests/unit/auth.test.ts electron/main/services/core/auth.ts
git commit -m "Add authentication service with password hashing, sessions, and audit logging"
```

---

### Task 5: Preferences service (remembered username)

**Files:**

- Create: `electron/main/services/core/preferences.ts`

- [ ] **Step 1: Write electron/main/services/core/preferences.ts**

```typescript
import Store from 'electron-store';

interface Preferences {
  lastUsername?: string;
}

const store = new Store<Preferences>({ name: 'preferences' });

export function getLastUsername(): string | null {
  return store.get('lastUsername') ?? null;
}

export function setLastUsername(username: string): void {
  store.set('lastUsername', username);
}
```

This deliberately only ever stores a username — never a password, never a session token. It uses `electron-store`, which needs a real Electron `app` context to resolve its config file path, which is why this stays out of `auth.ts` (kept plain-Node-testable) and is only called from the IPC handler layer (Task 7).

- [ ] **Step 2: Verify typecheck**

Run: `pnpm typecheck`
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add electron/main/services/core/preferences.ts
git commit -m "Add preferences service for remembering the last username"
```

---

### Task 6: Idle monitor for auto-lock

**Files:**

- Create: `electron/main/services/core/idle.ts`

- [ ] **Step 1: Write electron/main/services/core/idle.ts**

```typescript
import { BrowserWindow, powerMonitor } from 'electron';
import log from 'electron-log/main';
import { IPC_CHANNELS } from '@shared/ipc';
import { getSession, lockSession } from './auth';

const IDLE_THRESHOLD_SECONDS = 300;
const POLL_INTERVAL_MS = 30_000;

export function startIdleMonitor(window: BrowserWindow): NodeJS.Timeout {
  return setInterval(() => {
    const session = getSession();
    if (!session || session.isLocked) return;

    if (powerMonitor.getSystemIdleTime() >= IDLE_THRESHOLD_SECONDS) {
      lockSession()
        .then(() => {
          window.webContents.send(IPC_CHANNELS.sessionLocked);
        })
        .catch((error: unknown) => {
          log.error('Failed to lock session after idle timeout', error);
        });
    }
  }, POLL_INTERVAL_MS);
}
```

`powerMonitor.getSystemIdleTime()` is real OS-level idle detection (actual mouse/keyboard inactivity), not a renderer-side timer that stops if the renderer is busy or the window loses focus in a way that doesn't fire its own events. Polling every 30 seconds against a 5-minute threshold means the lock triggers somewhere between 5:00 and 5:30 of real idle time — acceptable imprecision for this use case, not worth a tighter poll interval. The `.catch()` matters here specifically because this runs on an unattended timer with no caller to propagate a rejection to — an uncaught rejection here would otherwise surface only as a generic Node warning, not a debuggable log entry.

- [ ] **Step 2: Verify typecheck**

Run: `pnpm typecheck`
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add electron/main/services/core/idle.ts
git commit -m "Add idle monitor for automatic session locking"
```

---

### Task 7: Wire IPC — preload, main handlers, remembered-username side effect

**Files:**

- Modify: `electron/preload/index.ts`
- Modify: `electron/main/ipc/index.ts`

- [ ] **Step 1: Replace electron/preload/index.ts with its full updated content**

```typescript
import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS, type AppApi } from '@shared/ipc';

const api: AppApi = {
  getAppVersion: () => ipcRenderer.invoke(IPC_CHANNELS.getAppVersion),
  checkDatabaseHealth: () => ipcRenderer.invoke(IPC_CHANNELS.checkDatabaseHealth),
  hasUsers: () => ipcRenderer.invoke(IPC_CHANNELS.hasUsers),
  createFirstAdmin: (username, password) =>
    ipcRenderer.invoke(IPC_CHANNELS.createFirstAdmin, username, password),
  login: (username, password) => ipcRenderer.invoke(IPC_CHANNELS.login, username, password),
  logout: () => ipcRenderer.invoke(IPC_CHANNELS.logout),
  unlock: (password) => ipcRenderer.invoke(IPC_CHANNELS.unlock, password),
  getSession: () => ipcRenderer.invoke(IPC_CHANNELS.getSession),
  getLastUsername: () => ipcRenderer.invoke(IPC_CHANNELS.getLastUsername),
  onSessionLocked: (callback) => {
    const listener = () => callback();
    ipcRenderer.on(IPC_CHANNELS.sessionLocked, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.sessionLocked, listener);
  },
};

contextBridge.exposeInMainWorld('omnes', api);
```

- [ ] **Step 2: Replace electron/main/ipc/index.ts with its full updated content**

```typescript
import { app, ipcMain } from 'electron';
import log from 'electron-log/main';
import { IPC_CHANNELS, type DatabaseHealthResult, type Session } from '@shared/ipc';
import { checkDatabaseHealth } from '../services/core/database';
import {
  createFirstAdmin,
  getSession,
  hasUsers,
  login,
  logout,
  unlock,
} from '../services/core/auth';
import { getLastUsername, setLastUsername } from '../services/core/preferences';

export function registerIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.getAppVersion, () => app.getVersion());

  ipcMain.handle(IPC_CHANNELS.checkDatabaseHealth, async (): Promise<DatabaseHealthResult> => {
    const connected = await checkDatabaseHealth();
    return { connected };
  });

  ipcMain.handle(IPC_CHANNELS.hasUsers, () => hasUsers());

  ipcMain.handle(
    IPC_CHANNELS.createFirstAdmin,
    async (_event, username: string, password: string): Promise<Session> => {
      const session = await createFirstAdmin(username, password);
      setLastUsername(session.username);
      return session;
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.login,
    async (_event, username: string, password: string): Promise<Session> => {
      const session = await login(username, password);
      setLastUsername(session.username);
      return session;
    },
  );

  ipcMain.handle(IPC_CHANNELS.logout, () => logout());

  ipcMain.handle(IPC_CHANNELS.unlock, async (_event, password: string): Promise<Session> => {
    try {
      return await unlock(password);
    } catch (error) {
      log.warn('Unlock attempt failed', error);
      throw error;
    }
  });

  ipcMain.handle(IPC_CHANNELS.getSession, (): Session | null => getSession());

  ipcMain.handle(IPC_CHANNELS.getLastUsername, (): string | null => getLastUsername());
}
```

`setLastUsername` is called from the IPC handler, not from inside `auth.ts` itself — see Task 5's note on why `auth.ts` stays free of `electron-store`. The failed-unlock `log.warn` call here follows the same reasoning: the design spec requires unlock failures to be logged via electron-log (distinct from the audit log, which deliberately does _not_ record failed-unlock attempts), and that logging lives at the IPC layer rather than inside `unlock()` itself, keeping `auth.ts` free of `electron-log` too — a plain-Node import that would otherwise need Electron's `app` context to resolve a log file path, the same testability concern as `electron-store`.

- [ ] **Step 3: Verify typecheck**

Run: `pnpm typecheck`
Expected: zero errors — this is what makes Task 3's expected failure go away.

- [ ] **Step 4: Commit**

```bash
git add electron/preload/index.ts electron/main/ipc/index.ts
git commit -m "Wire authentication IPC channels"
```

---

### Task 8: Start the idle monitor

**Files:**

- Modify: `electron/main/index.ts`

- [ ] **Step 1: Import and start the monitor after window creation**

Add the import:

```typescript
import { startIdleMonitor } from './services/core/idle';
```

In `app.whenReady().then(...)`, after `createMainWindow()` is called and its result is available, start the monitor. The existing code calls `createMainWindow()` without capturing its return value — change that call site to:

```typescript
const mainWindow = createMainWindow();
startIdleMonitor(mainWindow);
```

(replacing the bare `createMainWindow();` call inside the `whenReady` callback — leave the `app.on('activate', ...)` branch's own `createMainWindow()` call as-is, since re-starting a second idle monitor on `activate` isn't needed for this desktop app's single-window model.)

- [ ] **Step 2: Verify typecheck**

Run: `pnpm typecheck`
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add electron/main/index.ts
git commit -m "Start the idle monitor when the main window is created"
```

---

### Task 9: Locale strings

**Files:**

- Modify: `src/locales/en.json`, `src/locales/rw.json`, `src/locales/fr.json`

- [ ] **Step 1: Replace locale files with their full updated content**

`src/locales/en.json`:

```json
{
  "app.name": "OMNES",
  "shell.loading": "Loading...",
  "shell.comingSoon": "Coming soon",
  "shell.databaseConnected": "Database connected",
  "shell.databaseOffline": "Database offline",
  "auth.username": "Username",
  "auth.password": "Password",
  "auth.confirmPassword": "Confirm password",
  "auth.loginButton": "Log in",
  "auth.loginError": "Invalid username or password",
  "auth.createAdminTitle": "Create the administrator account",
  "auth.createAdminButton": "Create account",
  "auth.createAdminError": "Could not create the account. Please try again.",
  "auth.lockedTitle": "Session locked",
  "auth.unlockButton": "Unlock",
  "auth.unlockError": "Incorrect password",
  "auth.logout": "Log out",
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
  "auth.username": "Izina ry'ukoresha",
  "auth.password": "Ijambo ry'ibanga",
  "auth.confirmPassword": "Emeza ijambo ry'ibanga",
  "auth.loginButton": "Injira",
  "auth.loginError": "Izina ry'ukoresha cyangwa ijambo ry'ibanga sibyo",
  "auth.createAdminTitle": "Kora konti y'umuyobozi",
  "auth.createAdminButton": "Kora konti",
  "auth.createAdminError": "Kora konti byanze. Ongera ugerageze.",
  "auth.lockedTitle": "Igikorwa cyafunzwe",
  "auth.unlockButton": "Fungura",
  "auth.unlockError": "Ijambo ry'ibanga sibyo",
  "auth.logout": "Sohoka",
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
  "auth.username": "Nom d'utilisateur",
  "auth.password": "Mot de passe",
  "auth.confirmPassword": "Confirmer le mot de passe",
  "auth.loginButton": "Se connecter",
  "auth.loginError": "Nom d'utilisateur ou mot de passe invalide",
  "auth.createAdminTitle": "Créer le compte administrateur",
  "auth.createAdminButton": "Créer le compte",
  "auth.createAdminError": "Impossible de créer le compte. Veuillez réessayer.",
  "auth.lockedTitle": "Session verrouillée",
  "auth.unlockButton": "Déverrouiller",
  "auth.unlockError": "Mot de passe incorrect",
  "auth.logout": "Déconnexion",
  "modules.core": "Cœur",
  "modules.pos": "Point de vente",
  "modules.inventory": "Inventaire",
  "modules.crm": "Clients",
  "modules.reports": "Rapports",
  "modules.admin": "Administration"
}
```

- [ ] **Step 2: Commit**

```bash
git add src/locales
git commit -m "Add authentication locale strings"
```

---

### Task 10: Auth store (Zustand)

**Files:**

- Create: `src/lib/store/authStore.ts`

- [ ] **Step 1: Write src/lib/store/authStore.ts**

```typescript
import { create } from 'zustand';
import type { AppApi, Session } from '@shared/ipc';

function getApi(): AppApi {
  if (!window.omnes) {
    throw new Error('window.omnes is not available — the preload script did not load');
  }
  return window.omnes;
}

interface AuthState {
  session: Session | null;
  hasUsers: boolean | null;
  isInitializing: boolean;
  error: string | null;
  lastUsername: string | null;
  initialize: () => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  createFirstAdmin: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  unlock: (password: string) => Promise<void>;
  markLocked: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  session: null,
  hasUsers: null,
  isInitializing: true,
  error: null,
  lastUsername: null,

  initialize: async () => {
    const [hasUsersResult, session, lastUsername] = await Promise.all([
      getApi().hasUsers(),
      getApi().getSession(),
      getApi().getLastUsername(),
    ]);
    set({ hasUsers: hasUsersResult, session, lastUsername, isInitializing: false });
  },

  login: async (username, password) => {
    set({ error: null });
    try {
      const session = await getApi().login(username, password);
      set({ session, hasUsers: true });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Login failed' });
      throw error;
    }
  },

  createFirstAdmin: async (username, password) => {
    set({ error: null });
    try {
      const session = await getApi().createFirstAdmin(username, password);
      set({ session, hasUsers: true });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Could not create account' });
      throw error;
    }
  },

  logout: async () => {
    await getApi().logout();
    set({ session: null });
  },

  unlock: async (password) => {
    set({ error: null });
    try {
      const session = await getApi().unlock(password);
      set({ session });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Unlock failed' });
      throw error;
    }
  },

  markLocked: () => {
    set((state) => (state.session ? { session: { ...state.session, isLocked: true } } : state));
  },
}));
```

This store deliberately doesn't use the `?.` optional chaining Foundation's `AppShell` used for its version/database checks — auth is a mandatory gate the app cannot function without, so failing loudly if `window.omnes` is somehow missing is correct here, not a bug to guard against silently. But `window.omnes` is typed as optional (`Window.omnes?: AppApi`, set that way during Database Foundation's code review), so TypeScript correctly refuses plain `window.omnes.login(...)` calls with "possibly undefined" — the `getApi()` helper is what reconciles "the type says this can be missing" with "and if it is, that's a real error worth a clear message," rather than reaching for a `!` non-null assertion that would just produce a confusing runtime `TypeError` instead.

- [ ] **Step 2: Verify typecheck**

Run: `pnpm typecheck`
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/store/authStore.ts
git commit -m "Add Zustand auth store"
```

---

### Task 11: Shared auth-form styles and the login screen

**Files:**

- Create: `src/modules/core/AuthForm.module.css`
- Create: `src/modules/core/LoginScreen.tsx`

- [ ] **Step 1: Write src/modules/core/AuthForm.module.css**

```css
.screen {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: var(--color-background);
}

.card {
  width: 320px;
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-6);
  background-color: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
}

.title {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
  text-align: center;
}

.subtitle {
  margin: calc(-1 * var(--space-2)) 0 0;
  text-align: center;
  color: var(--color-text-secondary);
  font-size: 0.875rem;
}

.field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  font-size: 0.875rem;
  color: var(--color-text-secondary);
}

.field input {
  padding: var(--space-2) var(--space-3);
  background-color: var(--color-background);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  color: var(--color-text-primary);
  font-size: 1rem;
}

.fieldError {
  color: #e5484d;
  font-size: 0.75rem;
}

.formError {
  margin: 0;
  color: #e5484d;
  font-size: 0.875rem;
  text-align: center;
}

.card button[type='submit'] {
  padding: var(--space-3);
  background-color: var(--color-focus-ring);
  border: none;
  border-radius: var(--radius-md);
  color: white;
  font-weight: 600;
  cursor: pointer;
}

.card button[type='submit']:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
```

- [ ] **Step 2: Write src/modules/core/LoginScreen.tsx**

```typescript
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { useAuthStore } from '../../lib/store/authStore';
import styles from './AuthForm.module.css';

const loginSchema = z.object({
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
});

type LoginFormValues = z.infer<typeof loginSchema>;

export function LoginScreen() {
  const { t } = useTranslation();
  const login = useAuthStore((state) => state.login);
  const error = useAuthStore((state) => state.error);
  const lastUsername = useAuthStore((state) => state.lastUsername);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { username: lastUsername ?? '', password: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    try {
      await login(values.username, values.password);
    } catch {
      // error is already surfaced via the auth store
    }
  });

  return (
    <div className={styles.screen}>
      <form className={styles.card} onSubmit={onSubmit} noValidate>
        <h1 className={styles.title}>{t('app.name')}</h1>
        <label className={styles.field}>
          <span>{t('auth.username')}</span>
          <input type="text" autoFocus {...register('username')} />
          {errors.username && (
            <span className={styles.fieldError}>{errors.username.message}</span>
          )}
        </label>
        <label className={styles.field}>
          <span>{t('auth.password')}</span>
          <input type="password" {...register('password')} />
          {errors.password && (
            <span className={styles.fieldError}>{errors.password.message}</span>
          )}
        </label>
        {error && <p className={styles.formError}>{t('auth.loginError')}</p>}
        <button type="submit" disabled={isSubmitting}>
          {t('auth.loginButton')}
        </button>
      </form>
    </div>
  );
}
```

Form validation errors (empty fields) show their own Zod messages; the store's `error` (a real IPC failure, e.g. wrong password) always renders the same localized generic message regardless of the underlying English string, which is what keeps the "don't reveal whether the username exists" property from the design spec intact all the way to the UI.

- [ ] **Step 3: Verify typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add src/modules/core/AuthForm.module.css src/modules/core/LoginScreen.tsx
git commit -m "Add login screen"
```

---

### Task 12: First-admin bootstrap screen

**Files:**

- Create: `src/modules/core/CreateFirstAdminScreen.tsx`

- [ ] **Step 1: Write src/modules/core/CreateFirstAdminScreen.tsx**

```typescript
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { useAuthStore } from '../../lib/store/authStore';
import styles from './AuthForm.module.css';

const createAdminSchema = z
  .object({
    username: z.string().min(3, 'Username must be at least 3 characters'),
    password: z.string().min(8, 'Password must be at least 8 characters'),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

type CreateAdminFormValues = z.infer<typeof createAdminSchema>;

export function CreateFirstAdminScreen() {
  const { t } = useTranslation();
  const createFirstAdmin = useAuthStore((state) => state.createFirstAdmin);
  const error = useAuthStore((state) => state.error);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CreateAdminFormValues>({
    resolver: zodResolver(createAdminSchema),
    defaultValues: { username: '', password: '', confirmPassword: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    try {
      await createFirstAdmin(values.username, values.password);
    } catch {
      // error is already surfaced via the auth store
    }
  });

  return (
    <div className={styles.screen}>
      <form className={styles.card} onSubmit={onSubmit} noValidate>
        <h1 className={styles.title}>{t('auth.createAdminTitle')}</h1>
        <label className={styles.field}>
          <span>{t('auth.username')}</span>
          <input type="text" autoFocus {...register('username')} />
          {errors.username && (
            <span className={styles.fieldError}>{errors.username.message}</span>
          )}
        </label>
        <label className={styles.field}>
          <span>{t('auth.password')}</span>
          <input type="password" {...register('password')} />
          {errors.password && (
            <span className={styles.fieldError}>{errors.password.message}</span>
          )}
        </label>
        <label className={styles.field}>
          <span>{t('auth.confirmPassword')}</span>
          <input type="password" {...register('confirmPassword')} />
          {errors.confirmPassword && (
            <span className={styles.fieldError}>{errors.confirmPassword.message}</span>
          )}
        </label>
        {error && <p className={styles.formError}>{t('auth.createAdminError')}</p>}
        <button type="submit" disabled={isSubmitting}>
          {t('auth.createAdminButton')}
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Verify typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/modules/core/CreateFirstAdminScreen.tsx
git commit -m "Add first-admin bootstrap screen"
```

---

### Task 13: Lock screen

**Files:**

- Create: `src/modules/core/LockScreen.tsx`

- [ ] **Step 1: Write src/modules/core/LockScreen.tsx**

```typescript
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { useAuthStore } from '../../lib/store/authStore';
import styles from './AuthForm.module.css';

const unlockSchema = z.object({
  password: z.string().min(1, 'Password is required'),
});

type UnlockFormValues = z.infer<typeof unlockSchema>;

export function LockScreen() {
  const { t } = useTranslation();
  const unlock = useAuthStore((state) => state.unlock);
  const error = useAuthStore((state) => state.error);
  const session = useAuthStore((state) => state.session);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<UnlockFormValues>({
    resolver: zodResolver(unlockSchema),
    defaultValues: { password: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    try {
      await unlock(values.password);
    } catch {
      // error is already surfaced via the auth store
    }
  });

  return (
    <div className={styles.screen}>
      <form className={styles.card} onSubmit={onSubmit} noValidate>
        <h1 className={styles.title}>{t('auth.lockedTitle')}</h1>
        {session && <p className={styles.subtitle}>{session.username}</p>}
        <label className={styles.field}>
          <span>{t('auth.password')}</span>
          <input type="password" autoFocus {...register('password')} />
          {errors.password && (
            <span className={styles.fieldError}>{errors.password.message}</span>
          )}
        </label>
        {error && <p className={styles.formError}>{t('auth.unlockError')}</p>}
        <button type="submit" disabled={isSubmitting}>
          {t('auth.unlockButton')}
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Verify typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/modules/core/LockScreen.tsx
git commit -m "Add lock screen"
```

---

### Task 14: AuthGate, wired into App.tsx

**Files:**

- Create: `src/app/AuthGate.tsx`
- Modify: `src/app/App.tsx`

- [ ] **Step 1: Write src/app/AuthGate.tsx**

```typescript
import { useEffect, type ReactNode } from 'react';
import { useAuthStore } from '../lib/store/authStore';
import { CreateFirstAdminScreen } from '../modules/core/CreateFirstAdminScreen';
import { LoginScreen } from '../modules/core/LoginScreen';
import { LockScreen } from '../modules/core/LockScreen';

interface AuthGateProps {
  children: ReactNode;
}

export function AuthGate({ children }: AuthGateProps) {
  const hasUsers = useAuthStore((state) => state.hasUsers);
  const session = useAuthStore((state) => state.session);
  const isInitializing = useAuthStore((state) => state.isInitializing);
  const initialize = useAuthStore((state) => state.initialize);
  const markLocked = useAuthStore((state) => state.markLocked);

  useEffect(() => {
    void initialize();
  }, [initialize]);

  useEffect(() => window.omnes?.onSessionLocked(() => markLocked()), [markLocked]);

  if (isInitializing) {
    return null;
  }

  if (!hasUsers) {
    return <CreateFirstAdminScreen />;
  }

  if (!session) {
    return <LoginScreen />;
  }

  if (session.isLocked) {
    return <LockScreen />;
  }

  return <>{children}</>;
}
```

- [ ] **Step 2: Wire AuthGate into src/app/App.tsx**

Add the import:

```typescript
import { AuthGate } from './AuthGate';
```

Wrap the `HashRouter` (not the outer `motion.div`/`ErrorBoundary`) with `AuthGate`:

```tsx
<motion.div
  initial={{ opacity: 0 }}
  animate={{ opacity: 1 }}
  transition={{ duration: 0.25 }}
  style={{ height: '100%' }}
>
  <AuthGate>
    <HashRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Dashboard />} />
        </Route>
      </Routes>
    </HashRouter>
  </AuthGate>
</motion.div>
```

`AuthGate` sits inside the existing splash/fade gate (`isReady`/i18n), not instead of it — the app still waits for i18n before showing anything, and only then decides between the auth screens and the router.

- [ ] **Step 3: Verify typecheck, lint, and existing unit tests**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: zero errors, all pre-existing tests (`cn`, `AppShell`, `auth`) still pass — `AppShell.test.tsx` renders `AppShell` directly, not through `AuthGate`, so it's unaffected by this change.

- [ ] **Step 4: Commit**

```bash
git add src/app/AuthGate.tsx src/app/App.tsx
git commit -m "Gate the shell behind authentication"
```

---

### Task 15: Logout control in the shell

**Files:**

- Modify: `src/app/AppShell.tsx`
- Modify: `src/app/AppShell.module.css`

- [ ] **Step 1: Add session display and logout to AppShell.tsx**

Add the import:

```typescript
import { useAuthStore } from '../lib/store/authStore';
```

Inside `AppShell`, add:

```typescript
const session = useAuthStore((state) => state.session);
const logout = useAuthStore((state) => state.logout);
```

In the titlebar, after the existing `version`/`isDatabaseConnected` spans, add:

```tsx
{
  session && (
    <div className={styles.userControls}>
      <span className={styles.username}>{session.username}</span>
      <button
        type="button"
        className={styles.logoutButton}
        onClick={() => {
          void logout();
        }}
      >
        {t('auth.logout')}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Add the CSS**

In `src/app/AppShell.module.css`, add:

```css
.userControls {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.username {
  color: var(--color-text-secondary);
  font-size: 0.75rem;
}

.logoutButton {
  background: none;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  color: var(--color-text-secondary);
  font-size: 0.75rem;
  padding: var(--space-1) var(--space-2);
  cursor: pointer;
}
```

- [ ] **Step 3: Verify typecheck, lint, and existing unit tests**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: zero errors. `AppShell.test.tsx` renders `AppShell` outside any auth store setup — `session` will be `null` (the store's default), so the new `userControls` block simply doesn't render, and the existing sidebar-label assertions are unaffected.

- [ ] **Step 4: Commit**

```bash
git add src/app/AppShell.tsx src/app/AppShell.module.css
git commit -m "Add logout control to the shell"
```

---

### Task 16: Manual verification of the full auth flow

**Files:** none (verification only)

- [ ] **Step 1: Run the dev server and walk the flow**

Run: `pnpm dev`

The local `omnes_dev` database's `User` table is empty at this point (Task 4's tests clean up after themselves, and nothing else has created a user yet), so expect `CreateFirstAdminScreen` to appear first. If `LoginScreen` appears instead, a user already exists from earlier testing — either case is fine, just proceed with whichever screen you actually see.

If `CreateFirstAdminScreen` appears: create an account, confirm it lands on the shell with your username shown in the titlebar next to a "Log out" button.

If `LoginScreen` appears: log in with an existing account's credentials, confirm the same.

Then: click "Log out", confirm it returns to `LoginScreen`. Log in again with a deliberately wrong password, confirm the generic "Invalid username or password" message appears (not a raw error or a stack trace).

- [ ] **Step 2: Check for console/main-process errors**

Open DevTools (Ctrl+Shift+I), confirm no console errors. Check the terminal running `pnpm dev` for any `[error]` lines from electron-log.

- [ ] **Step 3: Stop the dev server**

Press `Ctrl+C`. (The 5-minute idle-lock timing isn't practical to verify by waiting manually — `lockSession()`/`unlock()`'s actual logic is already covered by Task 4's unit tests; this step only confirms the login/logout UI flow works end to end against the real app.)

---

### Task 17: Extend the Playwright e2e test for the bootstrap flow

**Files:**

- Modify: `playwright.config.ts`
- Modify: `tests/e2e/app.spec.ts`

- [ ] **Step 1: Load .env in the Playwright config**

This test file is about to import `electron/main/services/core/database.ts` directly (Step 2 below) to clear the `User` table between tests — but Playwright's test runner, like Vitest, does not load `.env` on its own; only our main process (`dotenv/config` in `electron/main/index.ts`) and, since Task 4, our Vitest setup file do. Without this, `DATABASE_URL` is `undefined` when the test file's top-level `import { prisma } from ...` runs, and the failure isn't an obvious "env var missing" error — it surfaces as `SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a string` from deep inside `pg`, which took a real test run to actually see. Add the same fix used in `prisma.config.ts` and `tests/unit/setup.ts`:

In `playwright.config.ts`, add as the first import:

```typescript
import 'dotenv/config';
```

- [ ] **Step 2: Add a beforeEach that clears the User table**

```typescript
import path from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import { prisma } from '../../electron/main/services/core/database';

test.beforeEach(async () => {
  await prisma.user.deleteMany();
});

test.afterAll(async () => {
  await prisma.$disconnect();
});

test('shows the first-admin bootstrap screen on a fresh database', async () => {
  const app = await electron.launch({
    args: [path.resolve(process.cwd(), 'out/main/index.js')],
  });

  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');

  await expect(window).toHaveTitle('OMNES');
  await expect(window.getByLabel('Username')).toBeVisible({ timeout: 10_000 });
  await expect(window.getByRole('button', { name: 'Create account' })).toBeVisible();

  await app.close();
});

test('bootstraps the first admin account and reaches the shell', async () => {
  const app = await electron.launch({
    args: [path.resolve(process.cwd(), 'out/main/index.js')],
  });

  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');

  await window.getByLabel('Username').fill('e2e-admin');
  await window.getByLabel('Password', { exact: true }).fill('e2e-test-password-123');
  await window.getByLabel('Confirm password').fill('e2e-test-password-123');
  await window.getByRole('button', { name: 'Create account' }).click();

  // Only reachable once authenticated — this is where the version badge,
  // database status, and sidebar (all previously asserted directly on
  // launch, before this sub-project added an auth gate in front of them)
  // now get checked, after a real login.
  await expect(window.getByText('Core')).toBeVisible({ timeout: 10_000 });
  await expect(window.getByText(/^v\d+\.\d+\.\d+$/)).toBeVisible();
  await expect(window.getByText('Database connected')).toBeVisible({ timeout: 10_000 });
  await expect(window.getByText('e2e-admin')).toBeVisible();

  await app.close();
});
```

The pre-authentication assertions (title, database status, version badge, `Core` sidebar) that the previous version of this test checked immediately on launch are no longer reachable that way — `AuthGate` (Task 14) replaces the entire shell with `CreateFirstAdminScreen` on an empty `User` table, so nothing inside `AppShell`'s titlebar exists in the DOM at all until a real login happens. The first test now checks what's actually true pre-auth (the bootstrap form renders); the second test does the real login and then re-asserts everything the shell is supposed to show, the same way a real user would only see it after authenticating.

Both tests deleting all users via `beforeEach` means these e2e tests are destructive to whatever's in the local database, the same tradeoff Task 4's unit tests already accepted — documented there, not repeated as a surprise here.

- [ ] **Step 3: Run the e2e tests**

Run: `pnpm test:e2e`
Expected: both tests PASS.

- [ ] **Step 4: Commit**

```bash
git add playwright.config.ts tests/e2e/app.spec.ts
git commit -m "Extend e2e tests to cover the first-admin bootstrap flow"
```

---

### Task 18: CI — apply the migration before tests run

**Files:**

- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Add a migrate deploy step**

In `.github/workflows/ci.yml`, add a step after `pnpm install --frozen-lockfile` and before `pnpm lint` (migrations don't affect lint/typecheck, but running them early means every later step — including `pnpm test`, which now hits the database — has a real schema to work against):

```yaml
- run: pnpm exec prisma migrate deploy
```

This is the first time this step has been needed — Database Foundation's CI didn't include it because that sub-project's schema had zero models and therefore zero migrations to deploy. Now there's a real migration (Task 2), so CI's freshly-created `postgres` service container needs it applied before `pnpm test` (which runs the new `auth.test.ts` against it) or `pnpm exec playwright test` (which runs the bootstrap e2e test) can pass.

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "Apply the database migration before running tests in CI"
```

---

### Task 19: Final integration check

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

Expected: every command exits 0, against the real local PostgreSQL database.

- [ ] **Step 2: Push the branch and open a PR**

```bash
git push -u origin feature/authentication
```

- [ ] **Step 3: Verify CI passes on GitHub**

Open the PR, confirm the Actions run (including the new `prisma migrate deploy` step and both e2e tests) passes on `ubuntu-latest` — the same verification discipline Database Foundation used, since CI's migration behavior can't be fully verified locally on Windows against a fresh container.

- [ ] **Step 4: Hand off for integration**

Use the `superpowers:finishing-a-development-branch` skill once CI is green.
