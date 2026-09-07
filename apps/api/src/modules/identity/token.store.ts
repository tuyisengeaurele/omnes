/**
 * Prisma-backed RefreshTokenStore. The only file in the token rotation path
 * that touches the database; token.service.ts contains no Prisma import.
 */

import { getDb } from '../../platform/db.js';
import type { RefreshTokenRecord, RefreshTokenStore } from './token.service.js';

export const prismaRefreshTokenStore: RefreshTokenStore = {
  async create(input) {
    return getDb().refreshToken.create({
      data: {
        userId: input.userId,
        tokenHash: input.tokenHash,
        familyId: input.familyId,
        audience: input.audience,
        expiresAt: input.expiresAt,
      },
    });
  },

  async findByHash(tokenHash: string): Promise<RefreshTokenRecord | null> {
    return getDb().refreshToken.findUnique({ where: { tokenHash } });
  },

  async markRotated(id: string, at: Date): Promise<void> {
    await getDb().refreshToken.update({
      where: { id },
      data: { rotatedAt: at, revokedAt: at },
    });
  },

  async revokeFamily(familyId: string, at: Date): Promise<void> {
    // revokedAt: null in the where clause keeps this idempotent: a token
    // already revoked (by an earlier rotation, or by an earlier reuse
    // detection on the same family) keeps its original revokedAt rather
    // than being overwritten with a later one.
    await getDb().refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: at },
    });
  },
};
