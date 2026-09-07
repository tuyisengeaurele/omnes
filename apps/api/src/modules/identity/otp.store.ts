/**
 * Prisma-backed OtpStore. The only file in the OTP path that touches the
 * database; otp.service.ts contains no Prisma import at all.
 */

import { getDb } from '../../platform/db.js';
import type { OtpChallengeRecord, OtpPurpose, OtpStore } from './otp.service.js';

export const prismaOtpStore: OtpStore = {
  async create(input) {
    const row = await getDb().otpChallenge.create({
      data: {
        phoneE164: input.phoneE164,
        codeHash: input.codeHash,
        purpose: input.purpose,
        expiresAt: input.expiresAt,
      },
    });
    return row;
  },

  async findLatest(phoneE164: string, purpose: OtpPurpose): Promise<OtpChallengeRecord | null> {
    return getDb().otpChallenge.findFirst({
      where: { phoneE164, purpose },
      orderBy: { createdAt: 'desc' },
    });
  },

  async incrementAttempts(id: string): Promise<void> {
    await getDb().otpChallenge.update({
      where: { id },
      data: { attempts: { increment: 1 } },
    });
  },

  async markConsumed(id: string, consumedAt: Date): Promise<void> {
    await getDb().otpChallenge.update({
      where: { id },
      data: { consumedAt },
    });
  },

  async countSince(phoneE164: string, since: Date): Promise<number> {
    return getDb().otpChallenge.count({
      where: { phoneE164, createdAt: { gte: since } },
    });
  },
};
