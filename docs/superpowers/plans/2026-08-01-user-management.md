# User Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An ADMIN can add staff accounts (MANAGER/CASHIER), change roles, reset passwords, and deactivate/reactivate accounts from the existing Administration page — the only way to create a `User` today is the one-time first-admin bootstrap.

**Architecture:** `users.ts` is the first service module where every exported function checks `getSession()?.role === 'ADMIN'` before doing anything — the second IPC-reachable role check in the app after Backup's restore, and the first to protect an entire module rather than one handler. Every mutation is guarded against removing the system's last active admin or letting an admin lock themselves out, and every mutation writes an `AuditLog` row using the existing enum, extended with new action values.

**Tech Stack:** No new npm dependencies — reuses `bcryptjs`, Prisma, React Hook Form, Zod, and the existing `User`/`AuditLog` models.

---

### Task 1: AuditAction additions and migration

**Files:**

- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add the new AuditAction values**

```prisma
enum AuditAction {
  LOGIN_SUCCESS
  LOGIN_FAILURE
  LOGOUT
  LOCK
  UNLOCK
  ADMIN_CREATED
  USER_CREATED
  USER_ROLE_CHANGED
  USER_DEACTIVATED
  USER_REACTIVATED
  USER_PASSWORD_RESET
}
```

Every new action's `AuditLog` row records the _target_ user (the one
created/changed), matching `ADMIN_CREATED`'s existing precedent — the
schema has one user reference per row, not a separate actor/subject
pair, so "who performed this" isn't captured here, same limitation the
schema already had before this sub-project.

- [ ] **Step 2: Generate and apply the migration**

Run: `pnpm exec prisma migrate dev --name add_user_management_audit_actions`
Expected: a new folder under `prisma/migrations/`.

- [ ] **Step 3: Verify typecheck**

Run: `pnpm typecheck`
Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git checkout main
git pull
git checkout -b feature/user-management
git add prisma/schema.prisma prisma/migrations
git commit -m "Add user-management audit actions"
```

---

### Task 2: Export validation constants from auth.ts

**Files:**

- Modify: `electron/main/services/core/auth.ts`

- [ ] **Step 1: Export SALT_ROUNDS, MIN_USERNAME_LENGTH, and MIN_PASSWORD_LENGTH**

Change:

```typescript
const SALT_ROUNDS = 12;
const INVALID_CREDENTIALS_MESSAGE = 'Invalid username or password';
const ACCOUNT_ALREADY_EXISTS_MESSAGE = 'An account already exists';
const MIN_USERNAME_LENGTH = 3;
const MIN_PASSWORD_LENGTH = 8;
```

to:

```typescript
export const SALT_ROUNDS = 12;
const INVALID_CREDENTIALS_MESSAGE = 'Invalid username or password';
const ACCOUNT_ALREADY_EXISTS_MESSAGE = 'An account already exists';
export const MIN_USERNAME_LENGTH = 3;
export const MIN_PASSWORD_LENGTH = 8;
```

`users.ts` (Task 3) reuses these rather than duplicating the same
literals with a real risk of the two drifting apart later.

- [ ] **Step 2: Verify typecheck and tests**

Run: `pnpm typecheck && pnpm test`
Expected: zero errors, all existing tests still passing (this is a
pure export addition, no behavior change).

- [ ] **Step 3: Commit**

```bash
git add electron/main/services/core/auth.ts
git commit -m "Export password/username validation constants for reuse"
```

---

### Task 3: Shared user-management types

**Files:**

- Modify: `shared/ipc.ts`

- [ ] **Step 1: Add user-management channels, types, and AppApi members**

Add to `IPC_CHANNELS`:

```typescript
  listUsers: 'user:list',
  createUser: 'user:create',
  setUserRole: 'user:set-role',
  setUserActive: 'user:set-active',
  resetUserPassword: 'user:reset-password',
```

Add after the `Sale`/`SaleItem`/`SaleResult` interfaces:

```typescript
export interface ManagedUser {
  id: string;
  username: string;
  role: Role;
  isActive: boolean;
  createdAt: string;
}

export interface UserResult {
  success: boolean;
  message: string;
  user: ManagedUser | null;
}
```

Add to `AppApi`:

```typescript
listUsers: () => Promise<ManagedUser[]>;
createUser: (username: string, password: string, role: Role) => Promise<UserResult>;
setUserRole: (id: string, role: Role) => Promise<UserResult>;
setUserActive: (id: string, isActive: boolean) => Promise<UserResult>;
resetUserPassword: (id: string, newPassword: string) => Promise<UserResult>;
```

`ManagedUser` deliberately has no `passwordHash` field — there's no
reason for it to ever exist on the renderer side of the IPC boundary.

- [ ] **Step 2: Verify typecheck**

Run: `pnpm typecheck`
Expected: fails — `electron/preload/index.ts` doesn't implement the new
`AppApi` members yet, fixed in Task 5.

- [ ] **Step 3: Commit**

```bash
git add shared/ipc.ts
git commit -m "Add user-management types to the shared IPC contract"
```

---

### Task 4: User-management service, with tests

**Files:**

- Create: `tests/unit/users.test.ts`
- Create: `electron/main/services/core/users.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createFirstAdmin, login } from '../../electron/main/services/core/auth';
import {
  createUser,
  listUsers,
  resetUserPassword,
  setUserActive,
  setUserRole,
} from '../../electron/main/services/core/users';
import { prisma } from '../../electron/main/services/core/database';

const OTHER_PASSWORD = 'other-password-123';

function uniqueUsername(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

async function bootstrapAdmin(): Promise<string> {
  const username = uniqueUsername('admin');
  await createFirstAdmin(username, 'admin-password-123');
  return username;
}

describe('users', () => {
  beforeEach(async () => {
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await prisma.user.deleteMany();
    await prisma.$disconnect();
  });

  it('rejects createUser from a non-admin session', async () => {
    await bootstrapAdmin();
    const cashierUsername = uniqueUsername('cashier');
    await createUser(cashierUsername, OTHER_PASSWORD, 'CASHIER');
    await login(cashierUsername, OTHER_PASSWORD);

    const result = await createUser(uniqueUsername('someone'), OTHER_PASSWORD, 'CASHIER');
    expect(result.success).toBe(false);
    expect(result.message).toBe('Only an administrator can manage users');
  });

  it('rejects setUserRole, setUserActive, and resetUserPassword from a non-admin session', async () => {
    await bootstrapAdmin();
    const cashierUsername = uniqueUsername('cashier');
    const created = await createUser(cashierUsername, OTHER_PASSWORD, 'CASHIER');
    const cashierId = created.user?.id as string;
    await login(cashierUsername, OTHER_PASSWORD);

    expect((await setUserRole(cashierId, 'MANAGER')).success).toBe(false);
    expect((await setUserActive(cashierId, false)).success).toBe(false);
    expect((await resetUserPassword(cashierId, 'new-password-123')).success).toBe(false);
  });

  it('creates a user who can immediately log in', async () => {
    await bootstrapAdmin();
    const username = uniqueUsername('cashier');

    const result = await createUser(username, OTHER_PASSWORD, 'CASHIER');
    expect(result.success).toBe(true);
    expect(result.user?.role).toBe('CASHIER');

    const session = await login(username, OTHER_PASSWORD);
    expect(session.username).toBe(username);
  });

  it('rejects a duplicate username', async () => {
    await bootstrapAdmin();
    const username = uniqueUsername('cashier');
    await createUser(username, OTHER_PASSWORD, 'CASHIER');

    const result = await createUser(username, OTHER_PASSWORD, 'CASHIER');
    expect(result.success).toBe(false);
    expect(result.message).toBe('Username already in use');
  });

  it('changes a role and resets a password', async () => {
    await bootstrapAdmin();
    const created = await createUser(uniqueUsername('cashier'), OTHER_PASSWORD, 'CASHIER');
    const id = created.user?.id as string;

    const roleResult = await setUserRole(id, 'MANAGER');
    expect(roleResult.success).toBe(true);
    expect(roleResult.user?.role).toBe('MANAGER');

    const passwordResult = await resetUserPassword(id, 'brand-new-password-123');
    expect(passwordResult.success).toBe(true);

    const target = await prisma.user.findUnique({ where: { id } });
    const session = await login(target!.username, 'brand-new-password-123');
    expect(session.userId).toBe(id);
  });

  it('rejects an admin deactivating their own account', async () => {
    const adminUsername = await bootstrapAdmin();
    const admin = await prisma.user.findUnique({ where: { username: adminUsername } });

    const result = await setUserActive(admin!.id, false);
    expect(result.success).toBe(false);
    expect(result.message).toBe('You cannot deactivate your own account');
  });

  it('rejects removing the role of the last active admin', async () => {
    const adminUsername = await bootstrapAdmin();
    const admin = await prisma.user.findUnique({ where: { username: adminUsername } });

    const result = await setUserRole(admin!.id, 'MANAGER');
    expect(result.success).toBe(false);
    expect(result.message).toBe('Cannot remove the last administrator');
  });

  it('allows deactivating a second admin when another remains active', async () => {
    await bootstrapAdmin();
    const secondAdmin = await createUser(uniqueUsername('admin2'), OTHER_PASSWORD, 'ADMIN');
    const id = secondAdmin.user?.id as string;

    const result = await setUserActive(id, false);
    expect(result.success).toBe(true);
    expect(result.user?.isActive).toBe(false);
  });

  it('lists users for an admin session without leaking passwordHash', async () => {
    await bootstrapAdmin();
    await createUser(uniqueUsername('cashier'), OTHER_PASSWORD, 'CASHIER');

    const users = await listUsers();
    expect(users.length).toBeGreaterThanOrEqual(2);
    expect(users.every((user) => !('passwordHash' in user))).toBe(true);
  });
});
```

Note why "rejects deactivating the last active admin" isn't a separate
test from "rejects an admin deactivating their own account": with
exactly one admin, the only session that could call `setUserActive` on
them (the function requires an ADMIN caller) is that same admin — the
self-deactivation guard is what actually fires first in that scenario.
The last-active-admin guard is exercised independently through
`setUserRole` instead, which has no self-check of its own.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test`
Expected: FAIL — `Cannot find module '../../electron/main/services/core/users'`.

- [ ] **Step 3: Write electron/main/services/core/users.ts**

```typescript
import bcrypt from 'bcryptjs';
import { Prisma } from '../../../../generated/prisma/client';
import { getSession, MIN_PASSWORD_LENGTH, MIN_USERNAME_LENGTH, SALT_ROUNDS } from './auth';
import { prisma } from './database';
import type { ManagedUser, Role, UserResult } from '@shared/ipc';

const NOT_ADMIN_MESSAGE = 'Only an administrator can manage users';

interface UserRow {
  id: string;
  username: string;
  role: Role;
  isActive: boolean;
  createdAt: Date;
}

function toManagedUser(row: UserRow): ManagedUser {
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
  };
}

function requireAdmin(): { userId: string; username: string } | null {
  const session = getSession();
  if (session?.role !== 'ADMIN') {
    return null;
  }
  return { userId: session.userId, username: session.username };
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    return 'Username already in use';
  }
  return error instanceof Error ? error.message : String(error);
}

export async function listUsers(): Promise<ManagedUser[]> {
  if (!requireAdmin()) {
    return [];
  }
  const rows = await prisma.user.findMany({ orderBy: { username: 'asc' } });
  return rows.map(toManagedUser);
}

export async function createUser(
  username: string,
  password: string,
  role: Role,
): Promise<UserResult> {
  if (!requireAdmin()) {
    return { success: false, message: NOT_ADMIN_MESSAGE, user: null };
  }

  try {
    if (username.trim().length < MIN_USERNAME_LENGTH) {
      throw new Error(`Username must be at least ${MIN_USERNAME_LENGTH} characters`);
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const row = await prisma.user.create({
      data: { username: username.trim(), passwordHash, role },
    });

    await prisma.auditLog.create({
      data: { userId: row.id, username: row.username, action: 'USER_CREATED' },
    });

    return { success: true, message: 'User created', user: toManagedUser(row) };
  } catch (error) {
    return { success: false, message: toErrorMessage(error), user: null };
  }
}

export async function setUserRole(id: string, role: Role): Promise<UserResult> {
  if (!requireAdmin()) {
    return { success: false, message: NOT_ADMIN_MESSAGE, user: null };
  }

  try {
    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) {
      throw new Error('User not found');
    }

    if (target.role === 'ADMIN' && target.isActive && role !== 'ADMIN') {
      const activeAdminCount = await prisma.user.count({
        where: { role: 'ADMIN', isActive: true },
      });
      if (activeAdminCount <= 1) {
        throw new Error('Cannot remove the last administrator');
      }
    }

    const row = await prisma.user.update({ where: { id }, data: { role } });

    await prisma.auditLog.create({
      data: { userId: row.id, username: row.username, action: 'USER_ROLE_CHANGED' },
    });

    return { success: true, message: 'Role updated', user: toManagedUser(row) };
  } catch (error) {
    return { success: false, message: toErrorMessage(error), user: null };
  }
}

export async function setUserActive(id: string, isActive: boolean): Promise<UserResult> {
  const admin = requireAdmin();
  if (!admin) {
    return { success: false, message: NOT_ADMIN_MESSAGE, user: null };
  }

  try {
    if (!isActive && id === admin.userId) {
      throw new Error('You cannot deactivate your own account');
    }

    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) {
      throw new Error('User not found');
    }

    if (!isActive && target.role === 'ADMIN' && target.isActive) {
      const activeAdminCount = await prisma.user.count({
        where: { role: 'ADMIN', isActive: true },
      });
      if (activeAdminCount <= 1) {
        throw new Error('Cannot deactivate the last administrator');
      }
    }

    const row = await prisma.user.update({ where: { id }, data: { isActive } });

    await prisma.auditLog.create({
      data: {
        userId: row.id,
        username: row.username,
        action: isActive ? 'USER_REACTIVATED' : 'USER_DEACTIVATED',
      },
    });

    return {
      success: true,
      message: isActive ? 'User reactivated' : 'User deactivated',
      user: toManagedUser(row),
    };
  } catch (error) {
    return { success: false, message: toErrorMessage(error), user: null };
  }
}

export async function resetUserPassword(id: string, newPassword: string): Promise<UserResult> {
  if (!requireAdmin()) {
    return { success: false, message: NOT_ADMIN_MESSAGE, user: null };
  }

  try {
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
    }

    const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    const row = await prisma.user.update({ where: { id }, data: { passwordHash } });

    await prisma.auditLog.create({
      data: { userId: row.id, username: row.username, action: 'USER_PASSWORD_RESET' },
    });

    return { success: true, message: 'Password reset', user: toManagedUser(row) };
  } catch (error) {
    return { success: false, message: toErrorMessage(error), user: null };
  }
}
```

This file imports nothing from `electron`, only `bcryptjs`, the
generated Prisma client, `database.ts`, and `auth.ts` (all themselves
Electron-free) — directly unit-testable, matching `auth.ts`/`sales.ts`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test`
Expected: PASS — all nine new tests plus every pre-existing test.

- [ ] **Step 5: Verify typecheck**

Run: `pnpm typecheck`
Expected: same pre-existing `AppApi` failure as Task 3, nothing new.

- [ ] **Step 6: Commit**

```bash
git add tests/unit/users.test.ts electron/main/services/core/users.ts
git commit -m "Add the user-management service"
```

---

### Task 5: Wire the user-management IPC channels

**Files:**

- Modify: `electron/preload/index.ts`
- Modify: `electron/main/ipc/index.ts`

- [ ] **Step 1: Add the user-management methods to electron/preload/index.ts**

Add to the `api` object:

```typescript
  listUsers: () => ipcRenderer.invoke(IPC_CHANNELS.listUsers),
  createUser: (username, password, role) =>
    ipcRenderer.invoke(IPC_CHANNELS.createUser, username, password, role),
  setUserRole: (id, role) => ipcRenderer.invoke(IPC_CHANNELS.setUserRole, id, role),
  setUserActive: (id, isActive) => ipcRenderer.invoke(IPC_CHANNELS.setUserActive, id, isActive),
  resetUserPassword: (id, newPassword) =>
    ipcRenderer.invoke(IPC_CHANNELS.resetUserPassword, id, newPassword),
```

- [ ] **Step 2: Add the handlers to electron/main/ipc/index.ts**

Add the import:

```typescript
import {
  createUser,
  listUsers,
  resetUserPassword,
  setUserActive,
  setUserRole,
} from '../services/core/users';
```

Add `ManagedUser`, `Role`, and `UserResult` to the existing `@shared/ipc` type import (`Role` is likely already imported for `Session`; only add it if not already present).

Add inside `registerIpcHandlers()`:

```typescript
ipcMain.handle(IPC_CHANNELS.listUsers, (): Promise<ManagedUser[]> => listUsers());

ipcMain.handle(
  IPC_CHANNELS.createUser,
  (_event, username: string, password: string, role: Role): Promise<UserResult> =>
    createUser(username, password, role),
);

ipcMain.handle(IPC_CHANNELS.setUserRole, (_event, id: string, role: Role): Promise<UserResult> =>
  setUserRole(id, role),
);

ipcMain.handle(
  IPC_CHANNELS.setUserActive,
  (_event, id: string, isActive: boolean): Promise<UserResult> => setUserActive(id, isActive),
);

ipcMain.handle(
  IPC_CHANNELS.resetUserPassword,
  (_event, id: string, newPassword: string): Promise<UserResult> =>
    resetUserPassword(id, newPassword),
);
```

- [ ] **Step 3: Verify typecheck**

Run: `pnpm typecheck`
Expected: zero errors — this is what makes Task 3's expected failure go away.

- [ ] **Step 4: Verify lint and tests**

Run: `pnpm lint && pnpm test`
Expected: zero errors, all tests passing.

- [ ] **Step 5: Commit**

```bash
git add electron/preload/index.ts electron/main/ipc/index.ts
git commit -m "Wire user-management IPC channels"
```

---

### Task 6: User-management locale strings

**Files:**

- Modify: `src/locales/en.json`, `src/locales/rw.json`, `src/locales/fr.json`

- [ ] _*Step 1: Add users.* keys to all three locale files_*

Add to `src/locales/en.json` (after the `pos.*` keys, before `modules.*`):

```json
  "users.title": "Users",
  "users.addUser": "Add user",
  "users.username": "Username",
  "users.password": "Password",
  "users.role": "Role",
  "users.roleAdmin": "Administrator",
  "users.roleManager": "Manager",
  "users.roleCashier": "Cashier",
  "users.cancel": "Cancel",
  "users.loading": "Loading...",
  "users.status": "Status",
  "users.active": "Active",
  "users.inactive": "Inactive",
  "users.deactivate": "Deactivate",
  "users.reactivate": "Reactivate",
  "users.resetPassword": "Reset password",
  "users.newPassword": "New password",
  "users.confirmReset": "Confirm",
```

Add to `src/locales/rw.json`:

```json
  "users.title": "Abakoresha",
  "users.addUser": "Ongeraho ukoresha",
  "users.username": "Izina ry'ukoresha",
  "users.password": "Ijambo ry'ibanga",
  "users.role": "Uruhare",
  "users.roleAdmin": "Umuyobozi",
  "users.roleManager": "Umuyobozi w'ishami",
  "users.roleCashier": "Umucuruzi",
  "users.cancel": "Hagarika",
  "users.loading": "Turacyategura...",
  "users.status": "Uko bimeze",
  "users.active": "Birakoreshwa",
  "users.inactive": "Ntibikoreshwa",
  "users.deactivate": "Hagarika",
  "users.reactivate": "Ongera ukoreshe",
  "users.resetPassword": "Hindura ijambo ry'ibanga",
  "users.newPassword": "Ijambo ry'ibanga rishya",
  "users.confirmReset": "Emeza",
```

Add to `src/locales/fr.json`:

```json
  "users.title": "Utilisateurs",
  "users.addUser": "Ajouter un utilisateur",
  "users.username": "Nom d'utilisateur",
  "users.password": "Mot de passe",
  "users.role": "Rôle",
  "users.roleAdmin": "Administrateur",
  "users.roleManager": "Gérant",
  "users.roleCashier": "Caissier",
  "users.cancel": "Annuler",
  "users.loading": "Chargement...",
  "users.status": "Statut",
  "users.active": "Actif",
  "users.inactive": "Inactif",
  "users.deactivate": "Désactiver",
  "users.reactivate": "Réactiver",
  "users.resetPassword": "Réinitialiser le mot de passe",
  "users.newPassword": "Nouveau mot de passe",
  "users.confirmReset": "Confirmer",
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm typecheck`
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/locales
git commit -m "Add user-management locale strings"
```

---

### Task 7: Add-user form

**Files:**

- Create: `src/modules/admin/AddUserForm.schema.ts`
- Create: `src/modules/admin/AddUserForm.module.css`
- Create: `src/modules/admin/AddUserForm.tsx`

- [ ] **Step 1: Write src/modules/admin/AddUserForm.schema.ts**

```typescript
import { z } from 'zod';

export const addUserFormSchema = z.object({
  username: z.string().trim().min(3, 'Username must be at least 3 characters'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  role: z.enum(['ADMIN', 'MANAGER', 'CASHIER']),
});

export type AddUserFormValues = z.infer<typeof addUserFormSchema>;
```

- [ ] **Step 2: Write src/modules/admin/AddUserForm.module.css**

```css
.form {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  max-width: 400px;
}

.title {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
}

.field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  font-size: 0.875rem;
  color: var(--color-text-secondary);
}

.field input,
.field select {
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

.actions {
  display: flex;
  gap: var(--space-3);
}

.actions button[type='submit'] {
  padding: var(--space-3);
  background-color: var(--color-focus-ring);
  border: none;
  border-radius: var(--radius-md);
  color: white;
  font-weight: 600;
  cursor: pointer;
}

.actions button[type='submit']:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.actions button[type='button'] {
  padding: var(--space-3);
  background: none;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  color: var(--color-text-secondary);
  cursor: pointer;
}
```

- [ ] **Step 3: Write src/modules/admin/AddUserForm.tsx**

```typescript
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { addUserFormSchema, type AddUserFormValues } from './AddUserForm.schema';
import styles from './AddUserForm.module.css';

interface AddUserFormProps {
  onSaved: () => void;
  onCancel: () => void;
}

export function AddUserForm({ onSaved, onCancel }: AddUserFormProps) {
  const { t } = useTranslation();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<AddUserFormValues>({
    resolver: zodResolver(addUserFormSchema),
    defaultValues: { username: '', password: '', role: 'CASHIER' },
  });

  const onSubmit = handleSubmit(async (values) => {
    const result = await window.omnes?.createUser(values.username, values.password, values.role);
    if (result?.success) {
      onSaved();
    }
  });

  return (
    <form className={styles.form} onSubmit={onSubmit} noValidate>
      <h2 className={styles.title}>{t('users.addUser')}</h2>
      <label className={styles.field}>
        <span>{t('users.username')}</span>
        <input type="text" autoFocus {...register('username')} />
        {errors.username && <span className={styles.fieldError}>{errors.username.message}</span>}
      </label>
      <label className={styles.field}>
        <span>{t('users.password')}</span>
        <input type="password" {...register('password')} />
        {errors.password && <span className={styles.fieldError}>{errors.password.message}</span>}
      </label>
      <label className={styles.field}>
        <span>{t('users.role')}</span>
        <select {...register('role')}>
          <option value="ADMIN">{t('users.roleAdmin')}</option>
          <option value="MANAGER">{t('users.roleManager')}</option>
          <option value="CASHIER">{t('users.roleCashier')}</option>
        </select>
      </label>
      <div className={styles.actions}>
        <button type="button" onClick={onCancel}>
          {t('users.cancel')}
        </button>
        <button type="submit" disabled={isSubmitting}>
          {t('users.addUser')}
        </button>
      </div>
    </form>
  );
}
```

- [ ] **Step 4: Verify typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add src/modules/admin/AddUserForm.schema.ts src/modules/admin/AddUserForm.module.css src/modules/admin/AddUserForm.tsx
git commit -m "Add the add-user form"
```

---

### Task 8: Users panel

**Files:**

- Create: `src/modules/admin/UsersPanel.module.css`
- Create: `src/modules/admin/UsersPanel.tsx`
- Modify: `src/modules/admin/AdminPage.tsx`

- [ ] **Step 1: Write src/modules/admin/UsersPanel.module.css**

```css
.panel {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  max-width: 900px;
}

.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.title {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
}

.toolbar button {
  padding: var(--space-2) var(--space-4);
  background-color: var(--color-focus-ring);
  border: none;
  border-radius: var(--radius-md);
  color: white;
  font-weight: 600;
  cursor: pointer;
}

.status {
  margin: 0;
  color: var(--color-text-secondary);
  font-size: 0.875rem;
}

.table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.875rem;
}

.table th {
  text-align: left;
  padding: var(--space-2) var(--space-3);
  color: var(--color-text-secondary);
  font-weight: 600;
  border-bottom: 1px solid var(--color-border);
}

.table td {
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--color-border);
  color: var(--color-text-primary);
}

.table tr[data-active='false'] {
  opacity: 0.5;
}

.table select {
  padding: var(--space-1) var(--space-2);
  background-color: var(--color-background);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  color: var(--color-text-primary);
  font-size: 0.8125rem;
}

.rowActions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.rowActions button {
  padding: var(--space-1) var(--space-3);
  background: none;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  color: var(--color-text-secondary);
  font-size: 0.75rem;
  cursor: pointer;
}

.rowActions button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.resetInline {
  display: flex;
  align-items: center;
  gap: var(--space-1);
}

.resetInline input {
  width: 120px;
  padding: var(--space-1) var(--space-2);
  background-color: var(--color-background);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  color: var(--color-text-primary);
  font-size: 0.75rem;
}
```

- [ ] **Step 2: Write src/modules/admin/UsersPanel.tsx**

```typescript
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ManagedUser, Role } from '@shared/ipc';
import { AddUserForm } from './AddUserForm';
import styles from './UsersPanel.module.css';

export function UsersPanel() {
  const { t } = useTranslation();
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [resettingId, setResettingId] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const fetchUsers = async () => {
    const list = await window.omnes?.listUsers();
    setUsers(list ?? []);
    setIsLoading(false);
  };

  useEffect(() => {
    let cancelled = false;
    window.omnes
      ?.listUsers()
      .then((list) => {
        if (!cancelled) {
          setUsers(list);
          setIsLoading(false);
        }
      })
      .catch((error: unknown) => {
        console.error('Failed to list users', error);
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleRoleChange = async (id: string, role: Role) => {
    setBusyId(id);
    const result = await window.omnes?.setUserRole(id, role);
    setBusyId(null);
    setStatusMessage(result?.message ?? null);
    await fetchUsers();
  };

  const handleToggleActive = async (user: ManagedUser) => {
    setBusyId(user.id);
    const result = await window.omnes?.setUserActive(user.id, !user.isActive);
    setBusyId(null);
    setStatusMessage(result?.message ?? null);
    await fetchUsers();
  };

  const handleResetPassword = async (id: string) => {
    setBusyId(id);
    const result = await window.omnes?.resetUserPassword(id, newPassword);
    setBusyId(null);
    setStatusMessage(result?.message ?? null);
    if (result?.success) {
      setResettingId(null);
      setNewPassword('');
    }
  };

  const handleSaved = () => {
    setIsAdding(false);
    void fetchUsers();
  };

  if (isAdding) {
    return <AddUserForm onSaved={handleSaved} onCancel={() => setIsAdding(false)} />;
  }

  return (
    <div className={styles.panel}>
      <div className={styles.toolbar}>
        <h2 className={styles.title}>{t('users.title')}</h2>
        <button type="button" onClick={() => setIsAdding(true)}>
          {t('users.addUser')}
        </button>
      </div>
      {statusMessage && <p className={styles.status}>{statusMessage}</p>}
      {isLoading ? (
        <p>{t('users.loading')}</p>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>{t('users.username')}</th>
              <th>{t('users.role')}</th>
              <th>{t('users.status')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id} data-active={user.isActive}>
                <td>{user.username}</td>
                <td>
                  <select
                    value={user.role}
                    onChange={(event) =>
                      void handleRoleChange(user.id, event.target.value as Role)
                    }
                    disabled={busyId === user.id}
                  >
                    <option value="ADMIN">{t('users.roleAdmin')}</option>
                    <option value="MANAGER">{t('users.roleManager')}</option>
                    <option value="CASHIER">{t('users.roleCashier')}</option>
                  </select>
                </td>
                <td>{user.isActive ? t('users.active') : t('users.inactive')}</td>
                <td className={styles.rowActions}>
                  <button
                    type="button"
                    onClick={() => void handleToggleActive(user)}
                    disabled={busyId === user.id}
                  >
                    {user.isActive ? t('users.deactivate') : t('users.reactivate')}
                  </button>
                  {resettingId === user.id ? (
                    <span className={styles.resetInline}>
                      <input
                        type="password"
                        placeholder={t('users.newPassword')}
                        value={newPassword}
                        onChange={(event) => setNewPassword(event.target.value)}
                      />
                      <button
                        type="button"
                        onClick={() => void handleResetPassword(user.id)}
                        disabled={newPassword.length < 8 || busyId === user.id}
                      >
                        {t('users.confirmReset')}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setResettingId(null);
                          setNewPassword('');
                        }}
                      >
                        {t('users.cancel')}
                      </button>
                    </span>
                  ) : (
                    <button type="button" onClick={() => setResettingId(user.id)}>
                      {t('users.resetPassword')}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Wire UsersPanel into AdminPage.tsx**

```typescript
import { useTranslation } from 'react-i18next';
import { BackupPanel } from './BackupPanel';
import { UsersPanel } from './UsersPanel';
import styles from './AdminPage.module.css';

export function AdminPage() {
  const { t } = useTranslation();

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>{t('modules.admin')}</h1>
      <BackupPanel />
      <UsersPanel />
    </div>
  );
}
```

- [ ] **Step 4: Verify typecheck, lint, and tests**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: zero errors, all tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/modules/admin/UsersPanel.tsx src/modules/admin/UsersPanel.module.css src/modules/admin/AdminPage.tsx
git commit -m "Add the users panel to Administration"
```

---

### Task 9: Extend the e2e test

**Files:**

- Modify: `tests/e2e/app.spec.ts`

- [ ] **Step 1: Add a user-creation round trip while already on the Administration page**

Add right after the existing restore-completion assertion (`await
expect(window.getByText('Restore completed'))...`) and before the
`Inventory` link click:

```typescript
const cashierUsername = `e2e-cashier-${Date.now()}`;
await window.getByRole('button', { name: 'Add user' }).click();
await window.getByLabel('Username').fill(cashierUsername);
await window.getByLabel('Password').fill('cashier-password-123');
await window.getByRole('button', { name: 'Add user' }).click();
await expect(window.getByText(cashierUsername)).toBeVisible({ timeout: 10_000 });
```

A per-run-unique username (`e2e-cashier-${Date.now()}`) means this
assertion never needs `.first()` — unlike the product-name case, each
run's username can never collide with a previous run's.

- [ ] **Step 2: Rebuild and run the e2e tests**

Run: `pnpm build && pnpm exec playwright test`
Expected: both tests PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/app.spec.ts
git commit -m "Extend e2e test to verify a user can be added"
```

---

### Task 10: Documentation, final verification, and merge

**Files:**

- Modify: `docs/architecture.md`

- [ ] **Step 1: Add a User Management section to docs/architecture.md, before the IPC contract section**

Cover: `users.ts` as the first module where every function checks
`role === 'ADMIN'` (not just one handler, matching but extending
Backup's restore precedent); the last-active-admin and
self-deactivation guards, and why the "last admin" guard is tested via
`setUserRole` rather than `setUserActive` (the self-check shadows it in
the single-admin case); that `AuditLog`'s new action values record the
target user, not the acting admin, matching `ADMIN_CREATED`'s existing
shape rather than a schema redesign; and that `ManagedUser` never
carries `passwordHash` across IPC.

- [ ] **Step 2: Run the full local verification suite**

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm package
```

Expected: every command exits 0.

- [ ] **Step 3: Push the branch and open a PR**

```bash
git push -u origin feature/user-management
```

- [ ] **Step 4: Verify CI passes on GitHub, dispatch an independent code-review subagent, address findings**

Follow the same pattern as every prior sub-project: once CI is green,
dispatch a fresh subagent to review the full branch diff against this
plan and the design spec before merging. Given this sub-project
introduces the app's first real role-based access control across an
entire module, review the guard logic (last-admin, self-deactivation,
non-admin rejection) with the same rigor Authentication's and POS's
concurrency fixes received.

- [ ] **Step 5: Merge via the finishing-a-development-branch skill once CI is green and review findings are addressed**
