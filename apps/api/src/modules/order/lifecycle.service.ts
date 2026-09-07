/**
 * Orchestrates the side effects of an order transition: the live tracking
 * push and the customer notification, both best-effort. A customer never
 * seeing an SSE update or a logged notification line is a degraded
 * experience; the order actually holding the wrong status because a side
 * effect failed and rolled back the transition with it would be worse, so
 * neither side effect can fail the caller or undo anything.
 *
 * Two entry points share that side-effect logic:
 *
 * - transition() performs the database write too (via lifecycle.repository)
 *   and is what the accept/reject/cancel routes call - a transition that
 *   has not happened yet anywhere else.
 * - announce() fires the side effects for a transition that already
 *   committed elsewhere. checkoutPayment.repository.ts's finalize() has to
 *   write the Order and PaymentIntent tables in one transaction (see that
 *   file's comment on why), which the standalone transitionOrder used here
 *   cannot join - so webhookProcessor.ts calls announce() afterward instead
 *   of transition(), to get the same push and notification without trying
 *   to redo a write that already happened.
 */

import type { NotificationPort } from '../../adapters/notification/index.js';
import type { RealtimePort } from '../../adapters/realtime/index.js';
import type { OrderStatus } from '../../generated/prisma/index.js';
import * as repo from './lifecycle.repository.js';
import type { TransitionOutcome } from './lifecycle.repository.js';

/**
 * What the customer is told for each status a transition can land on. A
 * status with no entry here is either not customer-facing yet (DRAFT,
 * PAID is folded into the MERCHANT_PENDING message that follows it a
 * moment later) or has no route that produces it yet in this phase
 * (ASSIGNED, PICKED_UP belong to dispatch, phase 7).
 */
const CUSTOMER_MESSAGES: Partial<Record<OrderStatus, (orderNumber: string) => string>> = {
  MERCHANT_PENDING: (n) => `Payment confirmed for order ${n}. The merchant has been notified.`,
  ACCEPTED: (n) => `Good news - the merchant has accepted order ${n}.`,
  PREPARING: (n) => `Order ${n} is being prepared.`,
  READY_FOR_PICKUP: (n) => `Order ${n} is ready and waiting for a driver.`,
  PICKED_UP: (n) => `Order ${n} is on its way.`,
  DELIVERED: (n) => `Order ${n} has been delivered. Enjoy!`,
  REJECTED: (n) => `The merchant was unable to accept order ${n}. You will be refunded.`,
  CANCELLED: (n) => `Order ${n} has been cancelled.`,
  REFUNDED: (n) => `Your payment for order ${n} has been refunded.`,
};

export interface AnnounceTransitionInput {
  orderId: string;
  orderNumber: string;
  customerId: string;
  status: OrderStatus;
}

export interface OrderLifecycleService {
  transition(
    input: repo.TransitionOrderInput & { orderNumber: string }
  ): Promise<TransitionOutcome>;
  announce(input: AnnounceTransitionInput): void;
}

export function createOrderLifecycleService(deps: {
  realtime: RealtimePort;
  notification: NotificationPort;
}): OrderLifecycleService {
  function announce(input: AnnounceTransitionInput): void {
    deps.realtime.publishOrderStatus({
      orderId: input.orderId,
      status: input.status,
      occurredAt: new Date().toISOString(),
    });

    const messageFor = CUSTOMER_MESSAGES[input.status];
    if (!messageFor) return;

    deps.notification
      .notify({
        userId: input.customerId,
        title: 'Order update',
        body: messageFor(input.orderNumber),
      })
      .catch(() => {
        // Best-effort: whatever committed the transition already
        // succeeded, and a failed notification is not a reason to fail
        // that on its behalf.
      });
  }

  async function transition(
    input: repo.TransitionOrderInput & { orderNumber: string }
  ): Promise<TransitionOutcome> {
    const outcome = await repo.transitionOrder(input);
    if (!outcome.applied) return outcome;

    announce({
      orderId: outcome.orderId,
      orderNumber: input.orderNumber,
      customerId: outcome.customerId,
      status: outcome.to,
    });

    return outcome;
  }

  return { transition, announce };
}
