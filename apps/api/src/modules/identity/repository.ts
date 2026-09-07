/**
 * User, credential, and role persistence. Thin CRUD with little branching
 * logic, unlike otp.service.ts and token.service.ts, so it talks to Prisma
 * directly rather than going through an injectable store - this is
 * exercised by the integration tests in routes.test.ts against a real
 * database, not by isolated unit tests against a fake.
 */

import { getDb } from '../../platform/db.js';
import type { RoleName } from '@omnes/contracts';

export interface UserRecord {
  id: string;
  phoneE164: string | null;
  email: string | null;
  displayName: string;
  locale: string;
  status: string;
}

export async function findUserByPhone(phoneE164: string): Promise<UserRecord | null> {
  return getDb().user.findUnique({
    where: { phoneE164 },
    select: {
      id: true,
      phoneE164: true,
      email: true,
      displayName: true,
      locale: true,
      status: true,
    },
  });
}

export async function findUserById(id: string): Promise<UserRecord | null> {
  return getDb().user.findUnique({
    where: { id },
    select: {
      id: true,
      phoneE164: true,
      email: true,
      displayName: true,
      locale: true,
      status: true,
    },
  });
}

/**
 * Creates a user, a verified PHONE_OTP credential, and the CUSTOMER role in
 * one transaction, so a partial failure never leaves a user with no way to
 * sign in or no role to be authorized against.
 */
export async function createCustomerFromVerifiedPhone(
  phoneE164: string,
  displayName: string
): Promise<UserRecord> {
  return getDb().$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        phoneE164,
        displayName,
        locale: 'en',
      },
      select: {
        id: true,
        phoneE164: true,
        email: true,
        displayName: true,
        locale: true,
        status: true,
      },
    });

    await tx.credential.create({
      data: {
        userId: user.id,
        type: 'PHONE_OTP',
        verifiedAt: new Date(),
      },
    });

    await tx.userRole.create({
      data: { userId: user.id, role: 'CUSTOMER' },
    });

    return user;
  });
}

export async function getRolesForUser(userId: string): Promise<RoleName[]> {
  const rows = await getDb().userRole.findMany({
    where: { userId },
    select: { role: true },
  });
  return rows.map((r) => r.role);
}

/**
 * The merchant a user owns, if any. Catalog's RBAC checks call this to
 * decide whether a MERCHANT_OWNER actor may write to a specific merchant -
 * the role alone only proves they own *some* merchant, not this one.
 */
export async function getMerchantIdForOwner(userId: string): Promise<string | null> {
  const profile = await getDb().merchantProfile.findUnique({
    where: { userId },
    select: { merchantId: true },
  });
  return profile?.merchantId ?? null;
}

/**
 * Links an already-provisioned merchant to its owner: a MerchantProfile row
 * and the MERCHANT_OWNER role, in one transaction. Called by catalog's
 * merchant-creation flow, which is why it lives on the identity side of the
 * module boundary - MerchantProfile is identity-owned data even though the
 * Merchant row itself belongs to catalog.
 */
export async function linkMerchantOwner(userId: string, merchantId: string): Promise<void> {
  await getDb().$transaction([
    getDb().merchantProfile.create({
      data: { userId, merchantId, status: 'APPROVED' },
    }),
    getDb().userRole.create({
      data: { userId, role: 'MERCHANT_OWNER' },
    }),
  ]);
}
