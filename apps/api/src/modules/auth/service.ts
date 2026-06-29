import bcrypt from 'bcryptjs';
import { prisma } from '../../config/prisma';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../../utils/jwt';
import crypto from 'crypto';

const REFRESH_TOKEN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

export async function loginUser(email: string, password: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.isActive) {
    return null;
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) return null;

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  const payload = { id: user.id, email: user.email, role: user.role };
  const accessToken = signAccessToken(payload);
  const rawRefreshToken = crypto.randomBytes(64).toString('hex');

  await prisma.refreshToken.create({
    data: {
      token: rawRefreshToken,
      userId: user.id,
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_EXPIRY_MS),
    },
  });

  return {
    accessToken,
    refreshToken: rawRefreshToken,
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
    },
  };
}

export async function rotateRefreshToken(rawToken: string) {
  const stored = await prisma.refreshToken.findUnique({ where: { token: rawToken } });

  if (!stored || stored.burned || stored.expiresAt < new Date()) {
    if (stored && !stored.burned) {
      await prisma.refreshToken.update({ where: { id: stored.id }, data: { burned: true } });
    }
    return null;
  }

  await prisma.refreshToken.update({ where: { id: stored.id }, data: { burned: true } });

  const user = await prisma.user.findUnique({ where: { id: stored.userId } });
  if (!user || !user.isActive) return null;

  const payload = { id: user.id, email: user.email, role: user.role };
  const accessToken = signAccessToken(payload);
  const newRawToken = crypto.randomBytes(64).toString('hex');

  await prisma.refreshToken.create({
    data: {
      token: newRawToken,
      userId: user.id,
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_EXPIRY_MS),
    },
  });

  return { accessToken, refreshToken: newRawToken };
}

export async function burnRefreshToken(rawToken: string) {
  await prisma.refreshToken.updateMany({
    where: { token: rawToken },
    data: { burned: true },
  });
}

export async function changeUserPassword(
  userId: string,
  currentPassword: string,
  newPassword: string
): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return false;

  const valid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!valid) return false;

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await prisma.user.update({ where: { id: userId }, data: { passwordHash } });
  return true;
}
