/**
 * DispatchOffer persistence: one row per driver an order was offered to,
 * per FR-DISP-005's "log every dispatch decision (offer, accept, decline,
 * timeout)". offeredAt/expiresAt/outcome together are that log for a single
 * driver-order pair; dispatch.service.ts is what actually decides whether
 * an unresolved offer has expired - this file only records what it is told.
 */

import { getDb } from '../../platform/db.js';
import type { DispatchOutcome } from '../../generated/prisma/index.js';

export interface OfferRecord {
  id: string;
  orderId: string;
  driverId: string;
  offeredAt: Date;
  expiresAt: Date;
  outcome: DispatchOutcome | null;
}

export async function createOffer(params: {
  orderId: string;
  driverId: string;
  expiresAt: Date;
}): Promise<OfferRecord> {
  return getDb().dispatchOffer.create({
    data: { orderId: params.orderId, driverId: params.driverId, expiresAt: params.expiresAt },
  });
}

export async function findOfferById(id: string): Promise<OfferRecord | null> {
  return getDb().dispatchOffer.findUnique({ where: { id } });
}

/**
 * The offer currently awaiting a response for this order, if any. Only one
 * should exist at a time by construction - dispatch.service.ts never
 * creates a new offer before resolving the last one - orderBy + first is a
 * defensive tiebreak, not evidence multiple are expected.
 */
export async function findOpenOfferForOrder(orderId: string): Promise<OfferRecord | null> {
  return getDb().dispatchOffer.findFirst({
    where: { orderId, outcome: null },
    orderBy: { offeredAt: 'desc' },
  });
}

export async function findOpenOffersForDriver(driverId: string): Promise<OfferRecord[]> {
  return getDb().dispatchOffer.findMany({
    where: { driverId, outcome: null },
    orderBy: { offeredAt: 'desc' },
  });
}

/**
 * Every driver this order has already been offered to, regardless of
 * outcome - dispatch.service.ts excludes all of them from the next
 * candidate search, whether they accepted (moot, dispatch is done),
 * declined, or timed out. Re-offering someone who just said no is not a
 * second chance, it is a bug.
 */
export async function findTriedDriverIds(orderId: string): Promise<string[]> {
  const rows = await getDb().dispatchOffer.findMany({
    where: { orderId },
    select: { driverId: true },
    distinct: ['driverId'],
  });
  return rows.map((row) => row.driverId);
}

export interface ResolveOfferResult {
  resolved: boolean;
}

/**
 * Sets an offer's outcome. Idempotent by construction: the where clause
 * only matches a row still outcome: null, so a resolution that already
 * happened - a driver double-tapping accept, or a timeout check racing a
 * response that just landed - reports resolved: false instead of
 * overwriting a real answer with a stale one.
 */
export async function resolveOffer(
  id: string,
  outcome: DispatchOutcome
): Promise<ResolveOfferResult> {
  const result = await getDb().dispatchOffer.updateMany({
    where: { id, outcome: null },
    data: { outcome },
  });
  return { resolved: result.count > 0 };
}
