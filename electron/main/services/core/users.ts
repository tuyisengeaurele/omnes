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
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      return 'Username already in use';
    }
    if (error.code === 'P2034') {
      return 'Another change is in progress — please try again';
    }
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
  const admin = requireAdmin();
  if (!admin) {
    return { success: false, message: NOT_ADMIN_MESSAGE, user: null };
  }

  try {
    if (id === admin.userId) {
      throw new Error('You cannot change your own role');
    }

    // The last-active-admin count check and the role update must be one
    // atomic unit, not two separate queries — two concurrent role changes
    // can otherwise both observe activeAdminCount > 1 and both proceed,
    // jointly leaving zero active admins. Same race class as
    // createFirstAdmin/createSale; Serializable isolation makes Postgres
    // detect the conflict and abort the loser with a P2034 error instead.
    const row = await prisma.$transaction(
      async (tx) => {
        const target = await tx.user.findUnique({ where: { id } });
        if (!target) {
          throw new Error('User not found');
        }

        if (target.role === 'ADMIN' && target.isActive && role !== 'ADMIN') {
          const activeAdminCount = await tx.user.count({
            where: { role: 'ADMIN', isActive: true },
          });
          if (activeAdminCount <= 1) {
            throw new Error('Cannot remove the last administrator');
          }
        }

        return tx.user.update({ where: { id }, data: { role } });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

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

    // Same atomicity requirement as setUserRole above — see the comment
    // there for why this must be one Serializable transaction, not a
    // separate count-then-update.
    const row = await prisma.$transaction(
      async (tx) => {
        const target = await tx.user.findUnique({ where: { id } });
        if (!target) {
          throw new Error('User not found');
        }

        if (!isActive && target.role === 'ADMIN' && target.isActive) {
          const activeAdminCount = await tx.user.count({
            where: { role: 'ADMIN', isActive: true },
          });
          if (activeAdminCount <= 1) {
            throw new Error('Cannot deactivate the last administrator');
          }
        }

        return tx.user.update({ where: { id }, data: { isActive } });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

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
