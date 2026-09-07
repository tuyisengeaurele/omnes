/**
 * Applies a payment's outcome - whether from the synchronous result of
 * initiating it, a webhook callback, or a lazy timeout check - to both the
 * PaymentIntent and the Order it belongs to, atomically. See
 * order/checkout.repository.ts for why writing to Order tables from here is
 * a deliberate choice, not a boundary violation: this is one transactional
 * workflow that happens to span two modules' tables, not a cross-module
 * function call.
 *
 * Every path here is idempotent by construction: once a PaymentIntent
 * reaches a terminal status (SUCCEEDED or FAILED), nothing here transitions
 * it again. A retried webhook, or a status check racing a webhook that just
 * landed, both resolve to "already applied" rather than double-processing.
 */

import { getDb } from '../../platform/db.js';
import { getLogger } from '../../platform/logger.js';
import { canTransition } from '../order/index.js';
import type { OrderStatus } from '../../generated/prisma/index.js';

export interface PaymentIntentRecord {
  id: string;
  orderId: string;
  /** The order's own human-readable number, for a notification message - see webhookProcessor.ts. */
  orderNumber: string;
  customerId: string;
  merchantId: string;
  /** The order's vertical - carried here so a webhook handler can resolve a commission rate without a second lookup. */
  vertical: string;
  status: string;
  amountMinor: bigint;
  currency: string;
  createdAt: Date;
}

async function loadIntent(
  where: { id: string } | { providerRef: string }
): Promise<PaymentIntentRecord | null> {
  const intent = await getDb().paymentIntent.findUnique({
    where,
    select: {
      id: true,
      orderId: true,
      status: true,
      amountMinor: true,
      currency: true,
      createdAt: true,
      order: { select: { orderNumber: true, customerId: true, merchantId: true, vertical: true } },
    },
  });
  if (!intent) return null;
  return {
    id: intent.id,
    orderId: intent.orderId,
    orderNumber: intent.order.orderNumber,
    customerId: intent.order.customerId,
    merchantId: intent.order.merchantId,
    vertical: intent.order.vertical,
    status: intent.status,
    amountMinor: intent.amountMinor,
    currency: intent.currency,
    createdAt: intent.createdAt,
  };
}

export async function findPaymentIntentById(id: string): Promise<PaymentIntentRecord | null> {
  return loadIntent({ id });
}

export async function findPaymentIntentByProviderRef(
  providerRef: string
): Promise<PaymentIntentRecord | null> {
  return loadIntent({ providerRef });
}

export type ApplyOutcome =
  | { applied: true; intent: PaymentIntentRecord }
  | { applied: false; reason: 'ALREADY_TERMINAL' | 'NOT_FOUND' | 'ORDER_NOT_TRANSITIONABLE' };

/**
 * Records that the initiate() call returned a providerRef and the payment
 * is now confirmed pending at the provider. Does not touch Order status:
 * PENDING_PAYMENT already covers this, and nothing has succeeded or failed
 * yet - only the request itself was accepted.
 */
export async function recordProviderRef(
  paymentIntentId: string,
  providerRef: string
): Promise<void> {
  await getDb().paymentIntent.update({
    where: { id: paymentIntentId },
    data: { providerRef },
  });
}

async function finalize(params: {
  paymentIntentId: string;
  newStatus: 'SUCCEEDED' | 'FAILED';
  providerRef?: string;
  providerCode?: string;
  providerMessage?: string;
}): Promise<ApplyOutcome> {
  const db = getDb();

  const result = await db.$transaction(async (tx) => {
    const intent = await tx.paymentIntent.findUnique({
      where: { id: params.paymentIntentId },
      select: {
        id: true,
        orderId: true,
        status: true,
        amountMinor: true,
        currency: true,
        createdAt: true,
        order: {
          select: {
            orderNumber: true,
            customerId: true,
            merchantId: true,
            status: true,
            vertical: true,
          },
        },
      },
    });
    if (!intent) return { applied: false, reason: 'NOT_FOUND' } as const;

    // Already terminal: a retried webhook, a duplicate synchronous result,
    // or a timeout check racing a webhook that just landed. Reporting this
    // as "already handled" rather than re-applying is the whole point.
    if (intent.status === 'SUCCEEDED' || intent.status === 'FAILED') {
      return { applied: false, reason: 'ALREADY_TERMINAL' } as const;
    }

    const newOrderStatus: OrderStatus = params.newStatus === 'SUCCEEDED' ? 'PAID' : 'CANCELLED';

    // The order's own status can now move independently of the payment -
    // order/lifecycle.routes.ts lets a customer or ops cancel while a
    // payment is still PENDING, which can race a webhook landing for that
    // same payment. canTransition is the single source of truth for
    // whether the order could still legally receive this result; if it
    // cannot, the payment intent itself still reaches a terminal status
    // below (that fact about the payment is true regardless), but the
    // order is left alone and the caller is told so it can skip posting a
    // ledger entry for money an already-cancelled order no longer expects.
    const orderTransitionable = canTransition(intent.order.status, newOrderStatus);
    if (!orderTransitionable) {
      getLogger().warn(
        {
          orderId: intent.orderId,
          orderStatus: intent.order.status,
          paymentResult: newOrderStatus,
        },
        'payment resolved for an order that can no longer accept that result - needs manual reconciliation'
      );
    }

    const priorAttempts = await tx.paymentAttempt.count({ where: { intentId: intent.id } });

    await tx.paymentIntent.update({
      where: { id: intent.id },
      data: {
        status: params.newStatus,
        ...(params.providerRef !== undefined ? { providerRef: params.providerRef } : {}),
      },
    });

    await tx.paymentAttempt.create({
      data: {
        intentId: intent.id,
        attemptNo: priorAttempts + 1,
        status: params.newStatus,
        ...(params.providerCode !== undefined ? { providerCode: params.providerCode } : {}),
        ...(params.providerMessage !== undefined
          ? { providerMessage: params.providerMessage }
          : {}),
      },
    });

    if (!orderTransitionable)
      return { applied: false, reason: 'ORDER_NOT_TRANSITIONABLE' } as const;

    // where also pins the expected current status, so a same-instant race
    // with another writer still cannot silently overwrite work that
    // canTransition's read did not see.
    const updateResult = await tx.order.updateMany({
      where: { id: intent.orderId, status: intent.order.status },
      data: { status: newOrderStatus },
    });
    if (updateResult.count === 0)
      return { applied: false, reason: 'ORDER_NOT_TRANSITIONABLE' } as const;

    await tx.orderEvent.create({
      data: {
        orderId: intent.orderId,
        fromStatus: intent.order.status,
        toStatus: newOrderStatus,
        actorType: 'SYSTEM',
        reason: params.newStatus === 'SUCCEEDED' ? 'payment succeeded' : 'payment failed',
      },
    });

    return {
      applied: true,
      intent: {
        id: intent.id,
        orderId: intent.orderId,
        orderNumber: intent.order.orderNumber,
        customerId: intent.order.customerId,
        merchantId: intent.order.merchantId,
        vertical: intent.order.vertical,
        status: params.newStatus,
        amountMinor: intent.amountMinor,
        currency: intent.currency,
        createdAt: intent.createdAt,
      },
    } as const;
  });

  return result;
}

export async function applyInitiateFailure(params: {
  paymentIntentId: string;
  errorCode: string;
  errorMessage: string;
}): Promise<ApplyOutcome> {
  return finalize({
    paymentIntentId: params.paymentIntentId,
    newStatus: 'FAILED',
    providerCode: params.errorCode,
    providerMessage: params.errorMessage,
  });
}

export async function applyWebhook(params: {
  providerRef: string;
  status: 'SUCCEEDED' | 'FAILED';
  errorCode?: string;
  errorMessage?: string;
}): Promise<ApplyOutcome> {
  const intent = await findPaymentIntentByProviderRef(params.providerRef);
  if (!intent) return { applied: false, reason: 'NOT_FOUND' };

  return finalize({
    paymentIntentId: intent.id,
    newStatus: params.status,
    ...(params.errorCode !== undefined ? { providerCode: params.errorCode } : {}),
    ...(params.errorMessage !== undefined ? { providerMessage: params.errorMessage } : {}),
  });
}

/**
 * A payment stuck PENDING past the configured timeout is treated as
 * expired. Checked lazily wherever a payment's status is read, rather than
 * by a background job - see platform/config.ts on PAYMENT_TIMEOUT_SECONDS.
 */
export async function applyTimeoutIfExpired(
  paymentIntentId: string,
  timeoutSeconds: number
): Promise<ApplyOutcome> {
  const intent = await findPaymentIntentById(paymentIntentId);
  if (!intent) return { applied: false, reason: 'NOT_FOUND' };
  if (intent.status !== 'PENDING') return { applied: false, reason: 'ALREADY_TERMINAL' };

  const ageSeconds = (Date.now() - intent.createdAt.getTime()) / 1000;
  if (ageSeconds < timeoutSeconds) return { applied: false, reason: 'ALREADY_TERMINAL' };

  return finalize({
    paymentIntentId,
    newStatus: 'FAILED',
    providerCode: 'TIMEOUT',
    providerMessage: `No confirmation received within ${timeoutSeconds} seconds.`,
  });
}
