/**
 * The order lifecycle state machine. This is the one place that decides
 * whether a transition is legal - see the comment on the OrderStatus enum
 * in schema.prisma, which documents the same graph and points back here.
 * Every write to Order.status, wherever it happens, is expected to check
 * canTransition first; lifecycle.repository.ts's transitionOrder is the one
 * place that actually does, so callers should go through that rather than
 * writing Order.status directly.
 *
 * Pure and synchronous on purpose: no database, no side effects, so the
 * full graph can be tested exhaustively without a transaction.
 */

import type { OrderStatus } from '../../generated/prisma/index.js';

/**
 * Cancellation is only offered while nothing irreversible has happened yet
 * on the merchant side - once PREPARING starts, the kitchen has already
 * committed real ingredients and labor to the order, so an MVP cancel button
 * stops being available. Reversing a paid order after that point is a job
 * for ops and the Refund flow, not a self-serve customer cancel - out of
 * scope for this phase, tracked for when the admin/ops surface exists.
 *
 * REFUNDED is reachable from DELIVERED, REJECTED and CANCELLED, since each
 * of those can be reached after a payment actually succeeded (rejection and
 * cancellation both happen after PAID in this graph). The graph tracks
 * status, not payment history, so it cannot by itself tell a CANCELLED
 * order that was never charged (PENDING_PAYMENT -> CANCELLED) apart from
 * one that was - that distinction belongs to whoever creates the Refund
 * row, which should only ever happen for an order a payment actually
 * succeeded on.
 */
export const ORDER_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  DRAFT: ['PENDING_PAYMENT', 'CANCELLED'],
  PENDING_PAYMENT: ['PAID', 'CANCELLED'],
  PAID: ['MERCHANT_PENDING'],
  MERCHANT_PENDING: ['ACCEPTED', 'REJECTED', 'CANCELLED'],
  ACCEPTED: ['PREPARING', 'CANCELLED'],
  PREPARING: ['READY_FOR_PICKUP'],
  READY_FOR_PICKUP: ['ASSIGNED'],
  ASSIGNED: ['PICKED_UP'],
  PICKED_UP: ['DELIVERED'],
  DELIVERED: ['REFUNDED'],
  REJECTED: ['REFUNDED'],
  CANCELLED: ['REFUNDED'],
  REFUNDED: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

export function isTerminal(status: OrderStatus): boolean {
  return ORDER_TRANSITIONS[status].length === 0;
}
