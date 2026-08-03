# User Management — Design

Status: Approved
Date: 2026-08-01

## Purpose

The only way a `User` row currently gets created is the one-time
first-admin bootstrap — there is no UI to add a second account at all.
A real shop needs staff accounts (managers, cashiers) beyond the owner
who set the app up, so this sub-project adds a Users section to the
existing Administration page: add a user, change their role, reset a
forgotten password, and deactivate/reactivate an account, all restricted
to ADMIN sessions. No new Prisma model — this operates on the `User`
table Authentication already established.

Success criteria: an ADMIN can create a MANAGER or CASHIER account and
that person can immediately log in with it; an ADMIN can change anyone's
role or reset their password; an ADMIN can deactivate an account (soft
delete, matching `Product.isActive`) without losing that user's
`AuditLog`/`Sale` history; the system refuses to deactivate the last
active ADMIN or let an ADMIN deactivate their own logged-in account,
since either would be an accidental self-lockout; every one of these
IPC calls rejects a non-ADMIN session outright — this is the first
sub-project to enforce role-based access control on more than one
handler (Backup's restore was the only precedent).

## Architecture

```
prisma/schema.prisma            # + AuditAction values: USER_CREATED,
                                  #   USER_ROLE_CHANGED, USER_DEACTIVATED,
                                  #   USER_REACTIVATED, USER_PASSWORD_RESET
electron/main/services/core/
├── auth.ts                       # export MIN_USERNAME_LENGTH/
                                    #   MIN_PASSWORD_LENGTH for reuse
└── users.ts                       # list/create/setRole/setActive/
                                     #   resetPassword, all ADMIN-gated
electron/main/ipc/
└── index.ts                       # + user:list/create/set-role/
                                     #   set-active/reset-password
shared/
└── ipc.ts                         # + ManagedUser type, channels, AppApi
src/modules/admin/
├── AdminPage.tsx                    # + <UsersPanel />
├── UsersPanel.tsx                    # table + inline row actions
└── AddUserForm.tsx                    # create-only form
```

## Components

- **`users.ts`**: every exported function starts by checking
  `getSession()?.role === 'ADMIN'`, returning
  `{ success: false, message: 'Only an administrator can manage users',
user: null }` immediately otherwise — matching `performRestore`'s
  precedent from Backup, the only other IPC-reachable handler in the app
  that checks role today. `listUsers()` returns `{ id, username, role,
isActive, createdAt }` — never `passwordHash`, which has no reason to
  ever cross IPC. `createUser(username, password, role)` reuses
  `MIN_USERNAME_LENGTH`/`MIN_PASSWORD_LENGTH` from `auth.ts` (exported
  for this purpose, not duplicated) and hashes with the same `bcryptjs`
  cost factor. `setUserRole(id, role)` and `setUserActive(id, isActive)`
  both check "is this the last active ADMIN" before permitting a change
  that would remove ADMIN status or deactivate the account — a `count`
  of `{ role: 'ADMIN', isActive: true }` greater than 1 is required to
  proceed; `setUserActive` additionally refuses if `id` matches the
  calling session's own `userId`. `resetUserPassword(id, newPassword)`
  hashes and overwrites `passwordHash` directly — no old-password
  confirmation, since IPC-level ADMIN gating is already the trust
  boundary for this action, the same way it is for restore. Every
  mutating action writes an `AuditLog` row (new `AuditAction` values)
  recording which admin performed it.
- **IPC**: `user:list`, `user:create`, `user:set-role`, `user:set-active`,
  `user:reset-password` — thin wrappers, matching every prior handler.
- **UI**: `UsersPanel.tsx` lists users in a table (username, a role
  `<select>` that calls `setRole` on change, active/inactive status, and
  per-row "Deactivate"/"Reactivate" and "Reset password" actions —
  the latter expands an inline password field + confirm button in that
  row, the same expand-in-place pattern `BackupPanel`'s restore
  confirmation already established, rather than a modal). `AddUserForm`
  is a simple create-only form (username, password, role) — unlike
  `ProductForm`, there's no shared add/edit form here, since editing an
  existing user is really three independent, narrow actions (role,
  active status, password), not one general-purpose edit.

## Data flow

Add: `AddUserForm` → `user:create` → `users.ts` validates, hashes,
inserts, audit-logs → the panel refetches `user:list`. Role change: the
row's `<select>` → `user:set-role` → same refetch. Deactivate/reactivate:
row button → `user:set-active` → same refetch, with a clear error shown
inline if the last-ADMIN or self-deactivation guard rejects it. Password
reset: inline field + confirm → `user:reset-password` → the field
collapses back on success.

## Error handling

- Every guard (non-ADMIN caller, last-active-ADMIN, self-deactivation,
  validation floor) returns a specific, human-readable message — never a
  raw Prisma error or a generic failure — matching every prior service's
  `Result`-shaped convention (`{ success, message, user }`).
- `passwordHash` is never included in any type or value that crosses IPC,
  checked directly in `users.ts`'s row-to-DTO mapping, the same
  discipline `sales.ts`/`products.ts` already apply to not leaking
  internal fields.

## Testing

- `users.test.ts` runs real CRUD against the real local database: a
  non-ADMIN session is rejected on every mutating call; creating a user
  with each role succeeds and the new account can `login()`; changing a
  role and resetting a password both take effect; deactivating the last
  active ADMIN is rejected while the count stays consistent; an ADMIN
  deactivating their own account is rejected; deactivating a second,
  non-last ADMIN succeeds.
- e2e: from the bootstrapped admin session, add a CASHIER user through
  the real form, confirm it appears in the list.

## Out of scope for this sub-project

Permission granularity beyond the three existing roles (no per-feature
permission toggles — `Role` stays a fixed enum), self-service password
change for a logged-in non-admin user (only an ADMIN resetting someone
else's password, via Administration — a user changing their own password
is a different, smaller feature that can be added later without
reworking this), user profile fields beyond username/role (no email,
phone, photo — nothing in the brief calls for them yet), and the
already-flagged separate bug where `auth.ts`'s `logout()`/`lockSession()`
crash on a stale session referencing a deleted user (tracked
independently, not fixed here).

## Git workflow

- Branch: `feature/user-management`, off `main`.
- Multiple small commits: `AuditAction` additions + migration → export
  validation constants from `auth.ts` → `users.ts` + tests → IPC wiring →
  `UsersPanel`/`AddUserForm` → wire into `AdminPage` → e2e.
- Merge to `main` via PR once verified locally and in CI.
