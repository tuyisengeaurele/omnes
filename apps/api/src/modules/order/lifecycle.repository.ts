/**
 * The one place that writes Order.status. Every transition - whether
 * triggered by a payment webhook, a merchant accepting an order, or a
 * customer cancelling one - goes through transitionOrder, which checks
 * canTransition before writing and always pairs the status change with an
 * OrderEvent in the same transaction, so the audit trail can never drift
 * from the status it is supposed to explain.
 *
 * The `where: { id, status: current }` on the update is an optimistic lock:
 * if something else changed the order's status between the read and the
 * write - a second request racing this one - the update matches zero rows
 * and this reports CONCURRENT_MODIFICATION rather than silently overwriting
 * whatever the other request just did.
 */

import { getDb } from '../../platform/db.js';
import type { ActorType, OrderStatus } from '../../generated/prisma/index.js';
import { canTransition } from './stateMachine.js';

export interface TransitionOrderInput {
  orderId: string;
  to: OrderStatus;
  actorType: ActorType;
  actorId?: string;
  reason?: string;
}

export type TransitionOutcome =
  | { applied: true; orderId: string; customerId: string; from: OrderStatus; to: OrderStatus }
  | { applied: false; reason: 'NOT_FOUND' }
  | { applied: false; reason: 'ILLEGAL_TRANSITION'; from: OrderStatus }
  | { applied: false; reason: 'CONCURRENT_MODIFICATION' };

export async function transitionOrder(input: TransitionOrderInput): Promise<TransitionOutcome> {
  const db = getDb();

  return db.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: input.orderId },
      select: { id: true, status: true, customerId: true },
    });
    if (!order) return { applied: false, reason: 'NOT_FOUND' };

    if (!canTransition(order.status, input.to)) {
      return { applied: false, reason: 'ILLEGAL_TRANSITION', from: order.status };
    }

    const updateResult = await tx.order.updateMany({
      where: { id: order.id, status: order.status },
      data: { status: input.to },
    });
    if (updateResult.count === 0) return { applied: false, reason: 'CONCURRENT_MODIFICATION' };

    await tx.orderEvent.create({
      data: {
        orderId: order.id,
        fromStatus: order.status,
        toStatus: input.to,
        actorType: input.actorType,
        ...(input.actorId !== undefined ? { actorId: input.actorId } : {}),
        ...(input.reason !== undefined ? { reason: input.reason } : {}),
      },
    });

    return {
      applied: true,
      orderId: order.id,
      customerId: order.customerId,
      from: order.status,
      to: input.to,
    };
  });
}
