/**
 * Cart business logic. Every mutation re-fetches the product's current
 * price, availability, and stock from catalog and revalidates against
 * them - a cart line is never trusted from what was stored when the item
 * was added, and a client can never supply its own price. See
 * docs/build-plan.md phase 4: "Cart operations that revalidate price and
 * availability server-side on every mutation."
 */

import type { Vertical } from '@omnes/contracts';
import type { MerchantRow, ProductRow } from '../catalog/index.js';
import * as repo from './cart.repository.js';
import { priceCart, type PriceBreakdown } from './pricing.js';

export interface CatalogLookup {
  findProductById(id: string): Promise<ProductRow | null>;
  findMerchantById(id: string): Promise<MerchantRow | null>;
}

export type AddItemOutcome =
  | { ok: true; item: repo.CartItemRow }
  | { ok: false; reason: 'PRODUCT_NOT_FOUND' | 'PRODUCT_NOT_IN_MERCHANT' | 'PRODUCT_UNAVAILABLE' }
  | { ok: false; reason: 'INSUFFICIENT_STOCK'; availableStock: number };

export type UpdateQuantityOutcome =
  | { ok: true; item: repo.CartItemRow }
  | { ok: false; reason: 'ITEM_NOT_FOUND' | 'PRODUCT_UNAVAILABLE' }
  | { ok: false; reason: 'INSUFFICIENT_STOCK'; availableStock: number };

export interface CartLineIssue {
  cartItemId: string;
  productId: string;
  issue: 'UNAVAILABLE' | 'INSUFFICIENT_STOCK' | 'PRICE_CHANGED' | 'REMOVED';
  currentPriceMinor?: string;
  availableStock?: number;
}

export interface CartLineView {
  id: string;
  productId: string;
  name: string;
  quantity: number;
  unitPriceMinor: bigint;
  notes: string | null;
}

export interface CartView {
  /** Null when nothing has been added yet - no cart row exists to have an id. */
  cartId: string | null;
  merchantId: string;
  currency: string;
  items: CartLineView[];
  issues: CartLineIssue[];
  pricing: PriceBreakdown;
}

export function createCartService(catalog: CatalogLookup) {
  async function resolveCartContext(merchantId: string) {
    const merchant = await catalog.findMerchantById(merchantId);
    if (!merchant) return null;
    return merchant;
  }

  async function addItem(
    userId: string,
    merchantId: string,
    input: { productId: string; quantity: number; notes?: string }
  ): Promise<AddItemOutcome> {
    const product = await catalog.findProductById(input.productId);
    if (!product) return { ok: false, reason: 'PRODUCT_NOT_FOUND' };
    if (product.merchantId !== merchantId) return { ok: false, reason: 'PRODUCT_NOT_IN_MERCHANT' };
    if (!product.isAvailable) return { ok: false, reason: 'PRODUCT_UNAVAILABLE' };

    const merchant = await resolveCartContext(merchantId);
    if (!merchant) return { ok: false, reason: 'PRODUCT_NOT_FOUND' };

    const cart = await repo.getOrCreateActiveCart(
      userId,
      merchantId,
      merchant.vertical as Vertical,
      product.currency
    );

    const existingLine = cart.items.find((i) => i.productId === input.productId);
    const requestedTotal = (existingLine?.quantity ?? 0) + input.quantity;

    if (product.stockCount !== null && requestedTotal > product.stockCount) {
      return { ok: false, reason: 'INSUFFICIENT_STOCK', availableStock: product.stockCount };
    }

    const item = await repo.addOrIncrementItem(cart.id, {
      productId: input.productId,
      quantity: input.quantity,
      unitPriceMinor: product.priceMinor,
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
    });

    return { ok: true, item };
  }

  async function updateQuantity(
    userId: string,
    cartItemId: string,
    quantity: number
  ): Promise<UpdateQuantityOutcome> {
    const existing = await repo.findCartItem(cartItemId);
    if (!existing) return { ok: false, reason: 'ITEM_NOT_FOUND' };

    const owner = await repo.findCartOwner(existing.cartId);
    if (owner !== userId) return { ok: false, reason: 'ITEM_NOT_FOUND' };

    const product = await catalog.findProductById(existing.productId);
    if (!product || !product.isAvailable) return { ok: false, reason: 'PRODUCT_UNAVAILABLE' };
    if (product.stockCount !== null && quantity > product.stockCount) {
      return { ok: false, reason: 'INSUFFICIENT_STOCK', availableStock: product.stockCount };
    }

    const item = await repo.updateItemQuantity(cartItemId, quantity, product.priceMinor);
    return { ok: true, item };
  }

  async function removeItem(
    userId: string,
    cartItemId: string
  ): Promise<{ ok: true } | { ok: false; reason: 'ITEM_NOT_FOUND' }> {
    const existing = await repo.findCartItem(cartItemId);
    if (!existing) return { ok: false, reason: 'ITEM_NOT_FOUND' };
    const owner = await repo.findCartOwner(existing.cartId);
    if (owner !== userId) return { ok: false, reason: 'ITEM_NOT_FOUND' };

    await repo.removeItem(cartItemId);
    return { ok: true };
  }

  /**
   * Revalidates every line against current catalog state before pricing.
   * Pricing is computed only from lines with no issue - an unavailable or
   * over-stock line stays visible in the cart for the customer to resolve,
   * but is never counted toward what they would actually be charged.
   */
  async function getCart(userId: string, merchantId: string): Promise<CartView | null> {
    const merchant = await resolveCartContext(merchantId);
    if (!merchant) return null;

    const cart = await repo.findActiveCart(userId, merchantId);
    if (!cart) {
      // Nothing to revalidate and nothing to write: the customer has not
      // added anything yet, or their previous cart expired. The currency
      // here comes from the city, since there is no cart or product row to
      // read one from instead.
      const currency = (await repo.findCityCurrency(merchant.cityId)) ?? 'RWF';
      return {
        cartId: null,
        merchantId,
        currency,
        items: [],
        issues: [],
        pricing: priceCart({
          items: [],
          currency,
          feeSchedule: { baseFeeMinor: 0n, perKmFeeMinor: 0n, serviceFeeBps: 0 },
        }),
      };
    }

    const issues: CartLineIssue[] = [];
    const validLines: Array<{ productId: string; unitPriceMinor: bigint; quantity: number }> = [];
    const itemViews: CartLineView[] = [];

    for (const line of cart.items) {
      const product = await catalog.findProductById(line.productId);

      if (!product) {
        issues.push({ cartItemId: line.id, productId: line.productId, issue: 'REMOVED' });
        continue;
      }

      itemViews.push({
        id: line.id,
        productId: line.productId,
        name: product.name,
        quantity: line.quantity,
        unitPriceMinor: product.priceMinor,
        notes: line.notes,
      });

      if (!product.isAvailable) {
        issues.push({ cartItemId: line.id, productId: line.productId, issue: 'UNAVAILABLE' });
        continue;
      }
      if (product.stockCount !== null && line.quantity > product.stockCount) {
        issues.push({
          cartItemId: line.id,
          productId: line.productId,
          issue: 'INSUFFICIENT_STOCK',
          availableStock: product.stockCount,
        });
        continue;
      }
      if (product.priceMinor !== line.unitPriceMinor) {
        issues.push({
          cartItemId: line.id,
          productId: line.productId,
          issue: 'PRICE_CHANGED',
          currentPriceMinor: product.priceMinor.toString(),
        });
      }

      validLines.push({
        productId: line.productId,
        unitPriceMinor: product.priceMinor,
        quantity: line.quantity,
      });
    }

    const feeSchedule = await repo.findActiveFeeSchedule(
      merchant.cityId,
      merchant.vertical as Vertical
    );

    const pricing = priceCart({
      items: validLines,
      currency: cart.currency,
      feeSchedule: feeSchedule ?? { baseFeeMinor: 0n, perKmFeeMinor: 0n, serviceFeeBps: 0 },
    });

    return {
      cartId: cart.id,
      merchantId,
      currency: cart.currency,
      items: itemViews,
      issues,
      pricing,
    };
  }

  async function clearCart(userId: string, merchantId: string): Promise<void> {
    const cart = await repo.findActiveCart(userId, merchantId);
    if (!cart) return;
    await repo.clearCart(cart.id);
  }

  return { addItem, updateQuantity, removeItem, getCart, clearCart };
}

export type CartService = ReturnType<typeof createCartService>;
