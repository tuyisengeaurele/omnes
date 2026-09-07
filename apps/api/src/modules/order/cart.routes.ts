/**
 * Cart routes. Every route requires an authenticated customer, and every
 * operation acts on that customer's own cart - userId always comes from
 * the verified session, never from a request parameter, so there is no
 * separate ownership check needed at this layer for who the cart belongs
 * to. Mutating a specific line (update/remove) still checks that the line
 * itself belongs to a cart owned by this user, which cart.service.ts does.
 */

import { Router } from 'express';
import { addCartItemSchema, updateCartItemQuantitySchema } from '@omnes/contracts';
import { requireAuth, type TokenService } from '../identity/index.js';
import { badRequest, notFound, unauthorized } from '../../platform/errors.js';
import { omitUndefined } from '../../platform/objectUtils.js';
import type { CartService, CartView } from './cart.service.js';
import type { PriceBreakdown } from './pricing.js';

function serializeMoney(breakdown: PriceBreakdown) {
  return {
    subtotalMinor: breakdown.subtotalMinor.toString(),
    deliveryFeeMinor: breakdown.deliveryFeeMinor.toString(),
    serviceFeeMinor: breakdown.serviceFeeMinor.toString(),
    discountMinor: breakdown.discountMinor.toString(),
    totalMinor: breakdown.totalMinor.toString(),
    currency: breakdown.currency,
  };
}

function serializeCart(view: CartView) {
  return {
    cartId: view.cartId,
    merchantId: view.merchantId,
    currency: view.currency,
    items: view.items.map((item) => ({
      id: item.id,
      productId: item.productId,
      name: item.name,
      quantity: item.quantity,
      unitPriceMinor: item.unitPriceMinor.toString(),
      notes: item.notes,
    })),
    issues: view.issues,
    pricing: serializeMoney(view.pricing),
  };
}

function addItemFailureMessage(reason: string): string {
  switch (reason) {
    case 'PRODUCT_NOT_FOUND':
      return 'No product matches this id.';
    case 'PRODUCT_NOT_IN_MERCHANT':
      return 'That product does not belong to this merchant.';
    case 'PRODUCT_UNAVAILABLE':
      return 'This item is currently unavailable.';
    default:
      return 'Not enough stock for the requested quantity.';
  }
}

export function createCartRouter(cart: CartService, tokenService: TokenService): Router {
  const router = Router();
  const requireCustomerAuth = requireAuth('customer', tokenService);
  router.use(requireCustomerAuth);

  router.get('/:merchantId', async (req, res) => {
    const actor = req.actor;
    if (!actor) throw unauthorized('UNAUTHENTICATED', 'Authentication required.');

    const view = await cart.getCart(actor.userId, req.params.merchantId);
    if (!view) throw notFound('MERCHANT_NOT_FOUND', 'No merchant matches this id.');

    res.status(200).json(serializeCart(view));
  });

  router.post('/:merchantId/items', async (req, res) => {
    const actor = req.actor;
    if (!actor) throw unauthorized('UNAUTHENTICATED', 'Authentication required.');

    const input = addCartItemSchema.parse(req.body);
    const outcome = await cart.addItem(actor.userId, req.params.merchantId, omitUndefined(input));

    if (!outcome.ok) {
      const details =
        outcome.reason === 'INSUFFICIENT_STOCK' ? { availableStock: outcome.availableStock } : {};
      throw badRequest('CART_ADD_FAILED', addItemFailureMessage(outcome.reason), details);
    }

    res.status(201).json({
      item: {
        id: outcome.item.id,
        productId: outcome.item.productId,
        quantity: outcome.item.quantity,
        unitPriceMinor: outcome.item.unitPriceMinor.toString(),
        notes: outcome.item.notes,
      },
    });
  });

  router.patch('/:merchantId/items/:itemId', async (req, res) => {
    const actor = req.actor;
    if (!actor) throw unauthorized('UNAUTHENTICATED', 'Authentication required.');

    const input = updateCartItemQuantitySchema.parse(req.body);
    const outcome = await cart.updateQuantity(actor.userId, req.params.itemId, input.quantity);

    if (!outcome.ok) {
      if (outcome.reason === 'ITEM_NOT_FOUND') {
        throw notFound('CART_ITEM_NOT_FOUND', 'No cart item matches this id.');
      }
      const details =
        outcome.reason === 'INSUFFICIENT_STOCK' ? { availableStock: outcome.availableStock } : {};
      throw badRequest(
        'CART_UPDATE_FAILED',
        outcome.reason === 'PRODUCT_UNAVAILABLE'
          ? 'This item is currently unavailable.'
          : 'Not enough stock for the requested quantity.',
        details
      );
    }

    res.status(200).json({
      item: {
        id: outcome.item.id,
        productId: outcome.item.productId,
        quantity: outcome.item.quantity,
        unitPriceMinor: outcome.item.unitPriceMinor.toString(),
        notes: outcome.item.notes,
      },
    });
  });

  router.delete('/:merchantId/items/:itemId', async (req, res) => {
    const actor = req.actor;
    if (!actor) throw unauthorized('UNAUTHENTICATED', 'Authentication required.');

    const outcome = await cart.removeItem(actor.userId, req.params.itemId);
    if (!outcome.ok) throw notFound('CART_ITEM_NOT_FOUND', 'No cart item matches this id.');

    res.status(204).send();
  });

  router.delete('/:merchantId', async (req, res) => {
    const actor = req.actor;
    if (!actor) throw unauthorized('UNAUTHENTICATED', 'Authentication required.');

    await cart.clearCart(actor.userId, req.params.merchantId);
    res.status(204).send();
  });

  return router;
}
