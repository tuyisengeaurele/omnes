/**
 * Checkout route. One endpoint: submit the current cart for a merchant as
 * an order and start payment. Idempotency lives in checkout.service.ts
 * (findCheckoutByIdempotencyKey), so a retried request - a slow network, a
 * double tap - resolves to the same order instead of creating a second one.
 *
 * csrfProtection sits here for the same reason it sits on the identity
 * module's refresh and logout routes: this is a state-changing request made
 * with an existing cookie session, which is exactly what CSRF targets.
 */

import { Router } from 'express';
import { checkoutSchema } from '@omnes/contracts';
import { requireAuth, type TokenService } from '../identity/index.js';
import { csrfProtection } from '../../platform/csrf.js';
import { badRequest, notFound, unauthorized } from '../../platform/errors.js';
import { omitUndefined } from '../../platform/objectUtils.js';
import type { CheckoutService } from './checkout.service.js';

function checkoutFailureError(
  reason: 'CART_EMPTY' | 'CART_HAS_ISSUES'
): ReturnType<typeof badRequest> {
  return reason === 'CART_EMPTY'
    ? badRequest('CART_EMPTY', 'The cart is empty.')
    : badRequest('CART_HAS_ISSUES', 'The cart has unresolved issues and cannot be checked out.');
}

export function createCheckoutRouter(
  checkout: CheckoutService,
  tokenService: TokenService
): Router {
  const router = Router();
  router.use(requireAuth('customer', tokenService));
  router.use(csrfProtection('customer'));

  router.post('/:merchantId', async (req, res) => {
    const actor = req.actor;
    if (!actor) throw unauthorized('UNAUTHENTICATED', 'Authentication required.');

    const input = checkoutSchema.parse(req.body);
    const outcome = await checkout.checkout(actor.userId, req.params.merchantId, {
      ...input,
      address: omitUndefined(input.address),
    });

    if (!outcome.ok) {
      if (outcome.reason === 'MERCHANT_NOT_FOUND') {
        throw notFound('MERCHANT_NOT_FOUND', 'No merchant matches this id.');
      }
      if (outcome.reason === 'PAYMENT_FAILED') {
        res.status(402).json({
          error: {
            code: outcome.errorCode,
            message: outcome.errorMessage,
          },
          orderId: outcome.orderId,
          orderNumber: outcome.orderNumber,
        });
        return;
      }
      throw checkoutFailureError(outcome.reason);
    }

    res.status(201).json({
      orderId: outcome.orderId,
      orderNumber: outcome.orderNumber,
      paymentStatus: outcome.paymentStatus,
    });
  });

  return router;
}
