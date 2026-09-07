/**
 * Orchestrates the offer/accept/decline/timeout loop and the radius
 * escalation and ops fallback FR-DISP-004 requires. Every dependency here
 * is injected - the same pattern checkout.service.ts uses - so the
 * escalation and fallback logic (the part actually worth testing closely)
 * runs against fakes in dispatch.service.test.ts, fast and without a real
 * database, while the repositories it is wired to in production are
 * exercised by their own real-database integration tests instead.
 *
 * There is deliberately no persisted "which radius are we at" field
 * anywhere. advanceDispatch recomputes it every time from DispatchOffer
 * history: every driver already offered this order (whatever the outcome)
 * is excluded, and the initial radius is searched again first. If that
 * search now comes back empty - because everyone in it has already been
 * tried - it naturally falls through to the escalated radius, and then to
 * ops fallback if that is empty too. No separate state to keep in sync,
 * at the cost of one extra (cheap, indexed) query on later calls once the
 * initial radius really is exhausted.
 */

import type { Coordinates } from '@omnes/contracts';
import type { GeoPort } from '../../adapters/geo/index.js';
import type { DispatchOutcome } from '../../generated/prisma/index.js';
import type { OrderLifecycleService } from '../order/index.js';
import type { DispatchCandidate, DispatchStrategy } from './strategy.js';
import type { CandidateLocationRow } from './availability.repository.js';
import type { OfferRecord } from './offer.repository.js';
import type { AssignmentRecord } from './assignment.repository.js';
import type { LogDecisionInput } from './decision.repository.js';

export interface DispatchOrderInfo {
  id: string;
  orderNumber: string;
  status: string;
  merchantId: string;
  pickup: Coordinates;
}

export interface DispatchDeps {
  geo: GeoPort;
  strategy: DispatchStrategy;
  lifecycle: OrderLifecycleService;
  offerTimeoutSeconds: number;
  initialRadiusMeters: number;
  escalatedRadiusMeters: number;
  findOrderInfo(orderId: string): Promise<DispatchOrderInfo | null>;
  findCandidates(params: {
    box: ReturnType<GeoPort['boundingBox']>;
    excludeDriverIds: string[];
  }): Promise<CandidateLocationRow[]>;
  createOffer(params: { orderId: string; driverId: string; expiresAt: Date }): Promise<OfferRecord>;
  findOfferById(id: string): Promise<OfferRecord | null>;
  findOpenOfferForOrder(orderId: string): Promise<OfferRecord | null>;
  findTriedDriverIds(orderId: string): Promise<string[]>;
  resolveOffer(id: string, outcome: DispatchOutcome): Promise<{ resolved: boolean }>;
  createAssignment(orderId: string, driverId: string): Promise<AssignmentRecord>;
  findAssignmentById(id: string): Promise<AssignmentRecord | null>;
  completeAssignment(id: string): Promise<void>;
  logDecision(input: LogDecisionInput): Promise<void>;
}

export type AdvanceOutcome =
  | { status: 'ORDER_NOT_FOUND' }
  | { status: 'ALREADY_ASSIGNED' }
  | { status: 'AWAITING_RESPONSE'; offer: OfferRecord }
  | { status: 'OFFERED'; offer: OfferRecord }
  | { status: 'NEEDS_OPS_ATTENTION' };

export type RespondOutcome =
  | { status: 'NOT_FOUND' }
  | { status: 'FORBIDDEN' }
  | { status: 'EXPIRED' }
  | { status: 'ALREADY_RESOLVED' }
  | { status: 'ACCEPTED'; assignmentId: string }
  | { status: 'DECLINED' };

export type AssignmentActionOutcome =
  | { status: 'NOT_FOUND' }
  | { status: 'FORBIDDEN' }
  | { status: 'ALREADY_COMPLETED' }
  | { status: 'ILLEGAL_TRANSITION' }
  | { status: 'OK' };

export interface DispatchService {
  advanceDispatch(orderId: string): Promise<AdvanceOutcome>;
  respondToOffer(
    offerId: string,
    driverId: string,
    userId: string,
    response: 'ACCEPTED' | 'DECLINED'
  ): Promise<RespondOutcome>;
  markPickedUp(
    assignmentId: string,
    driverId: string,
    userId: string
  ): Promise<AssignmentActionOutcome>;
  markDelivered(
    assignmentId: string,
    driverId: string,
    userId: string
  ): Promise<AssignmentActionOutcome>;
}

export function createDispatchService(deps: DispatchDeps): DispatchService {
  /**
   * lifecycle.transition needs the order's human-readable number for its
   * customer notification message (see order/lifecycle.service.ts). The
   * order is guaranteed to still exist at every call site below - each one
   * just read the offer or assignment that references it - so a missing
   * row here means the two tables have drifted out of sync with each
   * other, not a normal "not found" a caller should handle gracefully.
   */
  async function orderNumberFor(orderId: string): Promise<string> {
    const order = await deps.findOrderInfo(orderId);
    if (!order)
      throw new Error(
        `dispatch: order ${orderId} referenced by an offer or assignment no longer exists`
      );
    return order.orderNumber;
  }

  async function rankCandidates(
    pickup: Coordinates,
    radiusMeters: number,
    excludeDriverIds: string[]
  ): Promise<DispatchCandidate[]> {
    const box = deps.geo.boundingBox(pickup, radiusMeters);
    const rows = await deps.findCandidates({ box, excludeDriverIds });
    const withDistance = rows
      .map((row) => ({
        driverId: row.driverId,
        distanceMeters: deps.geo.distanceMeters(pickup, row),
      }))
      .filter((c) => c.distanceMeters <= radiusMeters);
    return deps.strategy.rank(withDistance);
  }

  async function tryRadius(
    order: DispatchOrderInfo,
    radiusMeters: number,
    excludeDriverIds: string[],
    escalated: boolean
  ): Promise<OfferRecord | null> {
    const startedAt = Date.now();
    const ranked = await rankCandidates(order.pickup, radiusMeters, excludeDriverIds);
    const chosen = ranked[0] ?? null;

    await deps.logDecision({
      orderId: order.id,
      strategy: deps.strategy.name,
      candidateCount: ranked.length,
      chosenDriverId: chosen?.driverId ?? null,
      latencyMs: Date.now() - startedAt,
      payload: { radiusMeters, escalated, alreadyTriedCount: excludeDriverIds.length },
    });

    if (!chosen) return null;

    const expiresAt = new Date(Date.now() + deps.offerTimeoutSeconds * 1000);
    return deps.createOffer({ orderId: order.id, driverId: chosen.driverId, expiresAt });
  }

  async function advanceDispatch(orderId: string): Promise<AdvanceOutcome> {
    const order = await deps.findOrderInfo(orderId);
    if (!order) return { status: 'ORDER_NOT_FOUND' };
    if (order.status !== 'READY_FOR_PICKUP') return { status: 'ALREADY_ASSIGNED' };

    const openOffer = await deps.findOpenOfferForOrder(orderId);
    if (openOffer) {
      if (openOffer.expiresAt.getTime() > Date.now()) {
        return { status: 'AWAITING_RESPONSE', offer: openOffer };
      }
      // Lazily discovered timeout - nothing runs on a schedule in this
      // deployable, so this is the moment an expired offer actually gets
      // marked as such: whoever next reads this order's dispatch state.
      await deps.resolveOffer(openOffer.id, 'TIMEOUT');
    }

    const triedDriverIds = await deps.findTriedDriverIds(orderId);

    const initialOffer = await tryRadius(order, deps.initialRadiusMeters, triedDriverIds, false);
    if (initialOffer) return { status: 'OFFERED', offer: initialOffer };

    const escalatedOffer = await tryRadius(order, deps.escalatedRadiusMeters, triedDriverIds, true);
    if (escalatedOffer) return { status: 'OFFERED', offer: escalatedOffer };

    return { status: 'NEEDS_OPS_ATTENTION' };
  }

  async function respondToOffer(
    offerId: string,
    driverId: string,
    userId: string,
    response: 'ACCEPTED' | 'DECLINED'
  ): Promise<RespondOutcome> {
    const offer = await deps.findOfferById(offerId);
    if (!offer) return { status: 'NOT_FOUND' };
    if (offer.driverId !== driverId) return { status: 'FORBIDDEN' };
    if (offer.outcome !== null) return { status: 'ALREADY_RESOLVED' };

    if (offer.expiresAt.getTime() <= Date.now()) {
      await deps.resolveOffer(offer.id, 'TIMEOUT');
      await advanceDispatch(offer.orderId);
      return { status: 'EXPIRED' };
    }

    const resolution = await deps.resolveOffer(offer.id, response);
    if (!resolution.resolved) return { status: 'ALREADY_RESOLVED' };

    if (response === 'DECLINED') {
      await advanceDispatch(offer.orderId);
      return { status: 'DECLINED' };
    }

    const orderNumber = await orderNumberFor(offer.orderId);
    const assignment = await deps.createAssignment(offer.orderId, driverId);
    await deps.lifecycle.transition({
      orderId: offer.orderId,
      orderNumber,
      to: 'ASSIGNED',
      actorType: 'DRIVER',
      actorId: userId,
    });
    return { status: 'ACCEPTED', assignmentId: assignment.id };
  }

  async function markPickedUp(
    assignmentId: string,
    driverId: string,
    userId: string
  ): Promise<AssignmentActionOutcome> {
    const assignment = await deps.findAssignmentById(assignmentId);
    if (!assignment) return { status: 'NOT_FOUND' };
    if (assignment.driverId !== driverId) return { status: 'FORBIDDEN' };
    if (assignment.completedAt) return { status: 'ALREADY_COMPLETED' };

    const outcome = await deps.lifecycle.transition({
      orderId: assignment.orderId,
      orderNumber: await orderNumberFor(assignment.orderId),
      to: 'PICKED_UP',
      actorType: 'DRIVER',
      actorId: userId,
    });
    if (!outcome.applied) return { status: 'ILLEGAL_TRANSITION' };
    return { status: 'OK' };
  }

  async function markDelivered(
    assignmentId: string,
    driverId: string,
    userId: string
  ): Promise<AssignmentActionOutcome> {
    const assignment = await deps.findAssignmentById(assignmentId);
    if (!assignment) return { status: 'NOT_FOUND' };
    if (assignment.driverId !== driverId) return { status: 'FORBIDDEN' };
    if (assignment.completedAt) return { status: 'ALREADY_COMPLETED' };

    const outcome = await deps.lifecycle.transition({
      orderId: assignment.orderId,
      orderNumber: await orderNumberFor(assignment.orderId),
      to: 'DELIVERED',
      actorType: 'DRIVER',
      actorId: userId,
    });
    if (!outcome.applied) return { status: 'ILLEGAL_TRANSITION' };

    await deps.completeAssignment(assignmentId);
    return { status: 'OK' };
  }

  return { advanceDispatch, respondToOffer, markPickedUp, markDelivered };
}
