/**
 * Ties a normalized webhook payload to the two things that must happen
 * when a payment succeeds: the state transition (applyWebhook, already
 * idempotent) and posting it to the ledger (also independently idempotent,
 * via LedgerTxn.reference). These run as two separate steps rather than one
 * transaction: applyWebhook's idempotency guard is what decides whether the
 * ledger should be touched at all, so it has to be known first, and the
 * ledger posting has its own retry-safe idempotency if this second step
 * fails and the webhook is redelivered.
 */

import type { Vertical } from '@omnes/contracts';
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

export async function processPaymentWebhook(
  input: ProcessWebhookInput
): Promise<ProcessWebhookResult> {
  const outcome = await applyWebhook({
    providerRef: input.providerRef,
    status: input.status,
    ...(input.errorCode !== undefined ? { errorCode: input.errorCode } : {}),
    ...(input.errorMessage !== undefined ? { errorMessage: input.errorMessage } : {}),
  });

  if (!outcome.applied) return { applied: false, reason: outcome.reason };
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

  return { applied: true, ledgerPosted: ledgerResult.paymentPosted };
}
