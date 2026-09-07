/**
 * Resolves which commission rate applies to a merchant's order: a
 * merchant-specific rule first, then a vertical-wide one, then a global
 * default - matching how a real ops team would expect to override a single
 * merchant's rate without having to touch every other merchant's.
 */

import type { Vertical } from '@omnes/contracts';
import { getDb } from '../../platform/db.js';

async function findRule(where: {
  merchantId: string | null;
  vertical: Vertical | null;
}): Promise<number | null> {
  const rule = await getDb().commissionRule.findFirst({
    where: { merchantId: where.merchantId, vertical: where.vertical },
    orderBy: { effectiveFrom: 'desc' },
    select: { rateBps: true },
  });
  return rule?.rateBps ?? null;
}

/**
 * Falls back to 0 only when nothing at all is configured - which should not
 * happen in a real deployment (a global default should always be seeded),
 * but checkout must never fail just because commission configuration is
 * missing.
 */
export async function findApplicableCommissionRateBps(
  merchantId: string,
  vertical: Vertical
): Promise<number> {
  const merchantSpecific = await findRule({ merchantId, vertical });
  if (merchantSpecific !== null) return merchantSpecific;

  const merchantAnyVertical = await findRule({ merchantId, vertical: null });
  if (merchantAnyVertical !== null) return merchantAnyVertical;

  const verticalWide = await findRule({ merchantId: null, vertical });
  if (verticalWide !== null) return verticalWide;

  const global = await findRule({ merchantId: null, vertical: null });
  return global ?? 0;
}
