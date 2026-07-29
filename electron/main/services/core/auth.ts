import bcrypt from 'bcryptjs';
import { prisma } from './database';
import { Prisma } from '../../../../generated/prisma/client';
import type { Role, Session } from '@shared/ipc';

const SALT_ROUNDS = 12;
const INVALID_CREDENTIALS_MESSAGE = 'Invalid username or password';
const ACCOUNT_ALREADY_EXISTS_MESSAGE = 'An account already exists';
const MIN_USERNAME_LENGTH = 3;
const MIN_PASSWORD_LENGTH = 8;

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
  if (username.trim().length < MIN_USERNAME_LENGTH) {
    throw new Error(`Username must be at least ${MIN_USERNAME_LENGTH} characters`);
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }

  // Renderer-side Zod validation enforces the same minimums, but the renderer
  // is not a trust boundary — DevTools can call window.omnes.createFirstAdmin
  // directly, bypassing any form. These checks are the real enforcement.

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  let user;
  try {
    // count-then-create must be one atomic unit, not two separate queries —
    // two concurrent calls can otherwise both observe count === 0 and both
    // successfully create an admin. Serializable isolation makes Postgres
    // detect that conflict and abort the loser with a P2034 error instead.
    user = await prisma.$transaction(
      async (tx) => {
        const existingCount = await tx.user.count();
        if (existingCount > 0) {
          throw new Error(ACCOUNT_ALREADY_EXISTS_MESSAGE);
        }
        return tx.user.create({
          data: { username, passwordHash, role: 'ADMIN' },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
      throw new Error(ACCOUNT_ALREADY_EXISTS_MESSAGE);
    }
    throw error;
  }

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
