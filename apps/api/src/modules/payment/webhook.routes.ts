/**
 * Payment webhook route. Stands in for what a real provider (MTN Mobile
 * Money, Airtel Money) would call once a customer approves or declines a
 * payment on their phone - see adapters/payment/index.ts on why initiate()
 * only ever reports PENDING.
 *
 * There is no session here to authenticate, so this is not behind
 * requireAuth or csrfProtection - a provider is not a logged-in browser.
 * Instead it must present a shared secret in a header, checked with the
 * same constant-time comparison the CSRF check uses. A real provider
 * integration would verify an HMAC signature over the raw body instead of
 * a static secret; a static shared secret is the MVP-scoped equivalent,
 * and swapping one for the other only touches this file.
 *
 * The route itself does no idempotency handling - applyWebhook and the
 * ledger's LedgerTxn.reference uniqueness, both already exercised by
 * processPaymentWebhook, are what make a redelivered webhook safe to
 * process twice.
 */

import { Router } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { paymentWebhookSchema } from '@omnes/contracts';
import { forbidden, notFound } from '../../platform/errors.js';
import { omitUndefined } from '../../platform/objectUtils.js';
import type { WebhookProcessor } from './webhookProcessor.js';

const WEBHOOK_SECRET_HEADER_NAME = 'x-webhook-secret';

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function createPaymentWebhookRouter(
  webhookProcessor: WebhookProcessor,
  webhookSecret: string
): Router {
  const router = Router();

  router.post('/mock', async (req, res) => {
    const provided = req.header(WEBHOOK_SECRET_HEADER_NAME);
    if (!provided || !safeEqual(provided, webhookSecret)) {
      throw forbidden('WEBHOOK_SECRET_INVALID', 'Missing or invalid webhook secret.');
    }

    const input = paymentWebhookSchema.parse(req.body);
    const outcome = await webhookProcessor.processPaymentWebhook(omitUndefined(input));

    if (!outcome.applied && outcome.reason === 'NOT_FOUND') {
      throw notFound('PAYMENT_INTENT_NOT_FOUND', 'No payment intent matches this providerRef.');
    }

    // ALREADY_TERMINAL is not an error - a redelivered webhook, or one that
    // raced a timeout that already resolved this intent - so it still
    // reports success back to the provider rather than asking for a retry.
    res.status(200).json({ received: true });
  });

  return router;
}
