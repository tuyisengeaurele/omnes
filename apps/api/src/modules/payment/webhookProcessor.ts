/**
 * Ties a normalized webhook payload to everything that must happen when a
 * payment resolves: the state transition (applyWebhook, already
 * idempotent), announcing it to whoever is tracking the order live, and -
 * on success - posting the ledger and moving the order on to await the
 * merchant. Each runs as its own separate step rather than one transaction:
 * applyWebhook's idempotency guard is what decides whether anything else
 * should happen at all, so it has to run first, and the ledger posting and
 * the follow-up transition both have their own retry-safe idempotency if a
 * later step fails and the webhook is redelivered.
 */

import type { Vertical } from '@omnes/contracts';
import type { OrderStatus } from '../../generated/prisma/index.js';
import type { OrderLifecycleService } from '../order/index.js';
import { applyWebhook, type ApplyOutcome } from './checkoutPayment.repository.js';
import { postOrderPaymentLedger } from './ledger.js';
import { findApplicableCommissionRateBps } from './commissionRule.repository.js';

export interface ProcessWebhookInput {
  providerRef: string;
  status: 'SUCCEEDED' | 'FAILED';
  errorCode?: string;
  errorMessage?: string;
}

export type ProcessWebhookResult =
  | { applied: true; ledgerPosted: boolean }
  | { applied: false; reason: Extract<ApplyOutcome, { applied: false }>['reason'] };

export interface WebhookProcessor {
  processPaymentWebhook(input: ProcessWebhookInput): Promise<ProcessWebhookResult>;
}

export function createWebhookProcessor(deps: {
  lifecycle: OrderLifecycleService;
}): WebhookProcessor {
  async function processPaymentWebhook(input: ProcessWebhookInput): Promise<ProcessWebhookResult> {
    const outcome = await applyWebhook({
      providerRef: input.providerRef,
      status: input.status,
      ...(input.errorCode !== undefined ? { errorCode: input.errorCode } : {}),
      ...(input.errorMessage !== undefined ? { errorMessage: input.errorMessage } : {}),
    });

    if (!outcome.applied) return { applied: false, reason: outcome.reason };

    // finalize() already committed the order's PENDING_PAYMENT -> PAID or
    // CANCELLED transition, inside the same transaction as the payment
    // intent write - see checkoutPayment.repository.ts on why the two
    // cannot be split. announce() only fires the side effects for a
    // transition that already happened; it does not repeat the write.
    const orderStatus: OrderStatus = outcome.intent.status === 'SUCCEEDED' ? 'PAID' : 'CANCELLED';
    deps.lifecycle.announce({
      orderId: outcome.intent.orderId,
      orderNumber: outcome.intent.orderNumber,
      customerId: outcome.intent.customerId,
      status: orderStatus,
    });

    if (input.status !== 'SUCCEEDED') return { applied: true, ledgerPosted: false };

    // The order's own vertical, carried on the intent record from the join
    // in checkoutPayment.repository.ts - not something this caller could
    // have known in advance, since which order this providerRef belongs to
    // is only resolved inside applyWebhook.
    const commissionRateBps = await findApplicableCommissionRateBps(
      outcome.intent.merchantId,
      outcome.intent.vertical as Vertical
    );

    const ledgerResult = await postOrderPaymentLedger({
      orderId: outcome.intent.orderId,
      merchantId: outcome.intent.merchantId,
      amountMinor: outcome.intent.amountMinor,
      currency: outcome.intent.currency,
      commissionRateBps,
    });

    // Automatic follow-up: a confirmed payment moves the order on to await
    // the merchant, with no human action in between. A real write via the
    // full transition() path, not another announce(), since nothing else
    // has performed this particular hop yet.
    await deps.lifecycle.transition({
      orderId: outcome.intent.orderId,
      orderNumber: outcome.intent.orderNumber,
      to: 'MERCHANT_PENDING',
      actorType: 'SYSTEM',
      reason: 'payment confirmed',
    });

    return { applied: true, ledgerPosted: ledgerResult.paymentPosted };
  }

  return { processPaymentWebhook };
}
