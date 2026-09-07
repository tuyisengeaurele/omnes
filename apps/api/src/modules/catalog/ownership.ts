/**
 * Merchant write access: OPS and SUPER_ADMIN may act on any merchant;
 * MERCHANT_OWNER may act only on the merchant they own. The role alone is
 * not enough to authorize a write - see identity's getMerchantIdForOwner,
 * which this calls to resolve which merchant a MERCHANT_OWNER actor
 * actually owns.
 *
 * A plain function rather than Express middleware, since some callers only
 * know which merchant is affected after an async lookup of their own (a
 * category or product's owning merchant), so the check has to happen after
 * that lookup, not before the route handler runs.
 */

import { getMerchantIdForOwner } from '../identity/index.js';
import { forbidden } from '../../platform/errors.js';
import type { Actor } from '../../platform/actor.js';

const STAFF_ROLES = new Set(['OPS', 'SUPER_ADMIN']);

export async function assertMerchantAccess(actor: Actor, merchantId: string): Promise<void> {
  if (actor.roles.some((role) => STAFF_ROLES.has(role))) return;

  if (actor.roles.includes('MERCHANT_OWNER')) {
    const ownedMerchantId = await getMerchantIdForOwner(actor.userId);
    if (ownedMerchantId === merchantId) return;
  }

  throw forbidden('FORBIDDEN', 'You do not have permission to modify this merchant.');
}
