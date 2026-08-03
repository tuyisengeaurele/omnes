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
