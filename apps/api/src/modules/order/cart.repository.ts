/**
 * Cart persistence. One cart per (customer, merchant) pair, matching the
 * schema's unique constraint - a customer can hold a draft cart per
 * merchant at once, since an order is always placed against one merchant.
 */

import { getDb } from '../../platform/db.js';
import type { Vertical } from '@omnes/contracts';

const CART_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface CartItemRow {
  id: string;
  cartId: string;
  productId: string;
  quantity: number;
  unitPriceMinor: bigint;
  notes: string | null;
}

export interface CartRow {
  id: string;
  userId: string;
  merchantId: string;
  vertical: string;
  currency: string;
  expiresAt: Date;
  items: CartItemRow[];
}

/**
 * Fetches the customer's cart for this merchant, creating one if none
 * exists, and transparently replacing it if the existing one has expired.
 * A caller never has to think about cart lifecycle - it always gets back a
 * live, non-expired cart.
 */
export async function getOrCreateActiveCart(
  userId: string,
  merchantId: string,
  vertical: Vertical,
  currency: string
): Promise<CartRow> {
  const db = getDb();
  const existing = await db.cart.findUnique({
    where: { userId_merchantId: { userId, merchantId } },
    include: { items: true },
  });

  const now = new Date();
  if (existing && existing.expiresAt > now) return existing;

  const expiresAt = new Date(now.getTime() + CART_TTL_MS);

  if (existing) {
    // Expired: clear its items and push the expiry out, rather than
    // deleting and recreating the row, so the cart id stays stable for
    // anything a caller may already have cached.
    await db.cartItem.deleteMany({ where: { cartId: existing.id } });
    return db.cart.update({
      where: { id: existing.id },
      data: { expiresAt },
      include: { items: true },
    });
  }

  return db.cart.create({
    data: { userId, merchantId, vertical, currency, expiresAt },
    include: { items: true },
  });
}

/**
 * Adding a product already in the cart increments its quantity instead of
 * inserting a second line for it - the schema has no unique constraint
 * forcing this, so it is enforced here. notes are not part of the match:
 * a note is treated as belonging to the line as a whole, not as making two
 * additions of the same product into different lines.
 */
export async function addOrIncrementItem(
  cartId: string,
  input: { productId: string; quantity: number; unitPriceMinor: bigint; notes?: string }
): Promise<CartItemRow> {
  const db = getDb();
  const existing = await db.cartItem.findFirst({
    where: { cartId, productId: input.productId },
  });

  if (existing) {
    return db.cartItem.update({
      where: { id: existing.id },
      data: {
        quantity: existing.quantity + input.quantity,
        unitPriceMinor: input.unitPriceMinor,
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
      },
    });
  }

  return db.cartItem.create({
    data: {
      cartId,
      productId: input.productId,
      quantity: input.quantity,
      unitPriceMinor: input.unitPriceMinor,
      notes: input.notes ?? null,
    },
  });
}

export async function findCartItem(cartItemId: string): Promise<CartItemRow | null> {
  return getDb().cartItem.findUnique({ where: { id: cartItemId } });
}

export async function updateItemQuantity(
  cartItemId: string,
  quantity: number,
  unitPriceMinor: bigint
): Promise<CartItemRow> {
  return getDb().cartItem.update({
    where: { id: cartItemId },
    data: { quantity, unitPriceMinor },
  });
}

export async function removeItem(cartItemId: string): Promise<void> {
  await getDb().cartItem.delete({ where: { id: cartItemId } });
}

export async function clearCart(cartId: string): Promise<void> {
  await getDb().cartItem.deleteMany({ where: { cartId } });
}

export async function findCartOwner(cartId: string): Promise<string | null> {
  const row = await getDb().cart.findUnique({ where: { id: cartId }, select: { userId: true } });
  return row?.userId ?? null;
}

export interface FeeScheduleRow {
  baseFeeMinor: bigint;
  perKmFeeMinor: bigint;
  serviceFeeBps: number;
}

/** The fee schedule in effect right now for this city and vertical. */
export async function findActiveFeeSchedule(
  cityId: string,
  vertical: Vertical
): Promise<FeeScheduleRow | null> {
  return getDb().feeSchedule.findFirst({
    where: { cityId, vertical, effectiveFrom: { lte: new Date() } },
    orderBy: { effectiveFrom: 'desc' },
    select: { baseFeeMinor: true, perKmFeeMinor: true, serviceFeeBps: true },
  });
}
