/**
 * DispatchDecision: one row per candidate-selection cycle (an initial
 * search, a radius escalation, or an ops-fallback determination), not one
 * per offer response - DispatchOffer already carries offeredAt, expiresAt
 * and outcome for that. This is the training data FR-DISP-005 and
 * docs/build-plan.md section 2 call for: which strategy ran, how many
 * candidates it had, who (if anyone) it picked, and how long it took.
 */

import { getDb } from '../../platform/db.js';
import type { Prisma } from '../../generated/prisma/index.js';

export interface LogDecisionInput {
  orderId: string;
  strategy: string;
  candidateCount: number;
  chosenDriverId: string | null;
  latencyMs: number;
  payload: Prisma.InputJsonValue;
}

export async function logDispatchDecision(input: LogDecisionInput): Promise<void> {
  await getDb().dispatchDecision.create({
    data: {
      orderId: input.orderId,
      strategy: input.strategy,
      candidateCount: input.candidateCount,
      chosenDriverId: input.chosenDriverId,
      latencyMs: input.latencyMs,
      payload: input.payload,
    },
  });
}

export interface StuckOrderRow {
  orderId: string;
  orderNumber: string;
  merchantId: string;
  placedAt: Date;
}

/**
 * READY_FOR_PICKUP with no offer currently both open and unexpired:
 * either dispatch never found a candidate at either radius (FR-DISP-004's
 * ops fallback), or it is between attempts and has not been read since, or
 * the driver it last offered went quiet and nothing has re-read that
 * order to notice the timeout yet (see dispatch.service.ts's lazy expiry -
 * an offer sitting past its expiresAt with outcome still null is exactly
 * as stuck as one that was never made). Either way, an order matching this
 * is what an ops dispatch view needs to surface. Order.offers is the
 * schema's own relation from Order to DispatchOffer; this reaches across
 * that relation directly rather than through the order module, the same
 * documented exception checkout.repository.ts and
 * checkoutPayment.repository.ts already make for a shared database query
 * that is not a cross-module function call.
 */
export async function findOrdersAwaitingDispatch(limit: number): Promise<StuckOrderRow[]> {
  const rows = await getDb().order.findMany({
    where: {
      status: 'READY_FOR_PICKUP',
      offers: { none: { outcome: null, expiresAt: { gt: new Date() } } },
    },
    select: { id: true, orderNumber: true, merchantId: true, placedAt: true },
    orderBy: { placedAt: 'asc' },
    take: limit,
  });
  return rows.map((row) => ({
    orderId: row.id,
    orderNumber: row.orderNumber,
    merchantId: row.merchantId,
    placedAt: row.placedAt,
  }));
}
