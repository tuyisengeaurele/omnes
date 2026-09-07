/**
 * Payment module: payment intents, ledger, wallet, commission, refunds,
 * payouts.
 *
 * This file is the module's only public surface. Other modules import from
 * here, never from a sibling file in this directory. Enforced by the
 * boundaries/element-types rule in the root eslint config.
 */

export { calculateCommission, splitCommission, type CommissionBreakdown } from './commission.js';
export {
  getOrCreateAccount,
  postLedgerTransaction,
  postOrderPaymentLedger,
  PLATFORM_OWNER_ID,
  type LedgerOwnerType,
  type LedgerAccountKind,
  type LedgerDirection,
} from './ledger.js';
export { findApplicableCommissionRateBps } from './commissionRule.repository.js';
export {
  findPaymentIntentById,
  findPaymentIntentByProviderRef,
  recordProviderRef,
  applyInitiateFailure,
  applyWebhook,
  applyTimeoutIfExpired,
  type PaymentIntentRecord,
  type ApplyOutcome,
} from './checkoutPayment.repository.js';
export { processPaymentWebhook, type ProcessWebhookResult } from './webhookProcessor.js';
export { createPaymentWebhookRouter } from './webhook.routes.js';
