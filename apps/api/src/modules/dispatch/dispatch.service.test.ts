/**
 * Dispatch orchestration tests against fakes, not a database - this is the
 * escalation-and-fallback logic itself, which is exactly what the
 * injectable-dependency pattern (see dispatch.service.ts's own module
 * comment) is for: fast, deterministic tests for the branching that
 * matters, real integration tests elsewhere for the repositories it is
 * wired to in production.
 */

import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { haversineGeoAdapter } from '../../adapters/geo/haversineAdapter.js';
import type { OrderLifecycleService } from '../order/index.js';
import { nearestAvailableStrategy } from './strategy.js';
import type { CandidateLocationRow } from './availability.repository.js';
import type { OfferRecord } from './offer.repository.js';
import type { AssignmentRecord } from './assignment.repository.js';
import type { LogDecisionInput } from './decision.repository.js';
import {
  createDispatchService,
  type DispatchDeps,
  type DispatchOrderInfo,
} from './dispatch.service.js';

const PICKUP = { latitude: -1.9441, longitude: 30.0619 };
const NEAR: CandidateLocationRow = { driverId: 'near', latitude: -1.945, longitude: 30.063 };
const NEARER: CandidateLocationRow = { driverId: 'nearer', latitude: -1.9445, longitude: 30.0625 };
const FAR_BUT_IN_ESCALATED_RADIUS: CandidateLocationRow = {
  driverId: 'far',
  latitude: -1.99,
  longitude: 30.1,
};

function buildFixture() {
  const orderId = randomUUID();
  const state = { status: 'READY_FOR_PICKUP' };
  const orderInfo: DispatchOrderInfo = {
    id: orderId,
    orderNumber: 'OM-TEST-0001',
    status: state.status,
    merchantId: randomUUID(),
    pickup: PICKUP,
  };

  let locations: CandidateLocationRow[] = [];
  const offers: OfferRecord[] = [];
  const assignments: AssignmentRecord[] = [];
  const decisions: LogDecisionInput[] = [];
  const lifecycleCalls: Array<{
    orderId: string;
    orderNumber: string;
    to: string;
    actorType: string;
  }> = [];

  const lifecycle: OrderLifecycleService = {
    transition: (input) => {
      lifecycleCalls.push({
        orderId: input.orderId,
        orderNumber: input.orderNumber,
        to: input.to,
        actorType: input.actorType,
      });
      state.status = input.to;
      return Promise.resolve({
        applied: true,
        orderId: input.orderId,
        customerId: 'customer-1',
        from: 'READY_FOR_PICKUP',
        to: input.to,
      } as never);
    },
    announce: () => {},
  };

  const deps: DispatchDeps = {
    geo: haversineGeoAdapter,
    strategy: nearestAvailableStrategy,
    lifecycle,
    offerTimeoutSeconds: 30,
    initialRadiusMeters: 3000,
    escalatedRadiusMeters: 8000,
    findOrderInfo: (id) =>
      Promise.resolve(id === orderId ? { ...orderInfo, status: state.status } : null),
    findCandidates: () => Promise.resolve(locations),
    createOffer: (params) => {
      const offer: OfferRecord = {
        id: randomUUID(),
        orderId: params.orderId,
        driverId: params.driverId,
        offeredAt: new Date(),
        expiresAt: params.expiresAt,
        outcome: null,
      };
      offers.push(offer);
      return Promise.resolve(offer);
    },
    findOfferById: (id) => Promise.resolve(offers.find((o) => o.id === id) ?? null),
    findOpenOfferForOrder: (id) =>
      Promise.resolve(offers.find((o) => o.orderId === id && o.outcome === null) ?? null),
    findTriedDriverIds: (id) =>
      Promise.resolve([...new Set(offers.filter((o) => o.orderId === id).map((o) => o.driverId))]),
    resolveOffer: (id, outcome) => {
      const offer = offers.find((o) => o.id === id);
      if (!offer || offer.outcome !== null) return Promise.resolve({ resolved: false });
      offer.outcome = outcome;
      return Promise.resolve({ resolved: true });
    },
    createAssignment: (orderIdArg, driverId) => {
      const assignment: AssignmentRecord = {
        id: randomUUID(),
        orderId: orderIdArg,
        driverId,
        assignedAt: new Date(),
        completedAt: null,
      };
      assignments.push(assignment);
      return Promise.resolve(assignment);
    },
    findAssignmentById: (id) => Promise.resolve(assignments.find((a) => a.id === id) ?? null),
    completeAssignment: (id) => {
      const assignment = assignments.find((a) => a.id === id);
      if (assignment) assignment.completedAt = new Date();
      return Promise.resolve();
    },
    logDecision: (input) => {
      decisions.push(input);
      return Promise.resolve();
    },
  };

  return {
    orderId,
    deps,
    decisions,
    offers,
    assignments,
    lifecycleCalls,
    state,
    setLocations: (rows: CandidateLocationRow[]) => {
      locations = rows;
    },
  };
}

describe('advanceDispatch', () => {
  it('reports ORDER_NOT_FOUND for an unknown order', async () => {
    const { deps } = buildFixture();
    const service = createDispatchService(deps);
    const outcome = await service.advanceDispatch(randomUUID());
    expect(outcome.status).toBe('ORDER_NOT_FOUND');
  });

  it('reports ALREADY_ASSIGNED once the order has moved past dispatch', async () => {
    const fixture = buildFixture();
    fixture.state.status = 'ASSIGNED';
    const service = createDispatchService(fixture.deps);
    const outcome = await service.advanceDispatch(fixture.orderId);
    expect(outcome.status).toBe('ALREADY_ASSIGNED');
  });

  it('offers the nearest candidate within the initial radius', async () => {
    const fixture = buildFixture();
    fixture.setLocations([NEAR, NEARER]);
    const service = createDispatchService(fixture.deps);

    const outcome = await service.advanceDispatch(fixture.orderId);

    expect(outcome.status).toBe('OFFERED');
    if (outcome.status === 'OFFERED') expect(outcome.offer.driverId).toBe('nearer');
    expect(fixture.decisions).toHaveLength(1);
    expect(fixture.decisions[0]).toMatchObject({
      candidateCount: 2,
      chosenDriverId: 'nearer',
      payload: { escalated: false },
    });
  });

  it('sets the offer to expire offerTimeoutSeconds from now', async () => {
    const fixture = buildFixture();
    fixture.setLocations([NEAR]);
    const service = createDispatchService(fixture.deps);

    const before = Date.now();
    await service.advanceDispatch(fixture.orderId);
    const offer = fixture.offers[0];

    expect(offer).toBeDefined();
    const expiresInMs = (offer?.expiresAt.getTime() ?? 0) - before;
    expect(expiresInMs).toBeGreaterThanOrEqual(29_000);
    expect(expiresInMs).toBeLessThanOrEqual(31_000);
  });

  it('escalates to the wider radius when nothing is in the initial one', async () => {
    const fixture = buildFixture();
    fixture.setLocations([FAR_BUT_IN_ESCALATED_RADIUS]);
    const service = createDispatchService(fixture.deps);

    const outcome = await service.advanceDispatch(fixture.orderId);

    expect(outcome.status).toBe('OFFERED');
    if (outcome.status === 'OFFERED') expect(outcome.offer.driverId).toBe('far');
    expect(fixture.decisions).toHaveLength(2);
    expect(fixture.decisions[0]).toMatchObject({ candidateCount: 0, chosenDriverId: null });
    expect(fixture.decisions[0]?.payload).toMatchObject({ escalated: false });
    expect(fixture.decisions[1]).toMatchObject({ candidateCount: 1, chosenDriverId: 'far' });
    expect(fixture.decisions[1]?.payload).toMatchObject({ escalated: true });
  });

  it('reports NEEDS_OPS_ATTENTION when nobody is in range at either radius', async () => {
    const fixture = buildFixture();
    fixture.setLocations([]);
    const service = createDispatchService(fixture.deps);

    const outcome = await service.advanceDispatch(fixture.orderId);

    expect(outcome.status).toBe('NEEDS_OPS_ATTENTION');
    expect(fixture.decisions).toHaveLength(2);
    expect(fixture.offers).toHaveLength(0);
  });

  it('reports AWAITING_RESPONSE without logging a new decision while an offer is still open', async () => {
    const fixture = buildFixture();
    fixture.setLocations([NEAR]);
    const service = createDispatchService(fixture.deps);
    await service.advanceDispatch(fixture.orderId);
    expect(fixture.decisions).toHaveLength(1);

    const outcome = await service.advanceDispatch(fixture.orderId);

    expect(outcome.status).toBe('AWAITING_RESPONSE');
    expect(fixture.decisions).toHaveLength(1);
  });

  it('times out an expired offer and tries the next candidate, excluding the timed-out driver', async () => {
    const fixture = buildFixture();
    fixture.setLocations([NEAR]);
    const service = createDispatchService(fixture.deps);
    await service.advanceDispatch(fixture.orderId);
    const firstOffer = fixture.offers[0];
    if (!firstOffer) throw new Error('expected an offer to have been created');
    firstOffer.expiresAt = new Date(Date.now() - 1000); // force it into the past

    fixture.setLocations([NEAR, NEARER]); // NEAR already tried; NEARER is new
    const outcome = await service.advanceDispatch(fixture.orderId);

    expect(firstOffer.outcome).toBe('TIMEOUT');
    expect(outcome.status).toBe('OFFERED');
    if (outcome.status === 'OFFERED') expect(outcome.offer.driverId).toBe('nearer');
  });
});

describe('respondToOffer', () => {
  it('reports NOT_FOUND for an unknown offer', async () => {
    const { deps } = buildFixture();
    const service = createDispatchService(deps);
    const outcome = await service.respondToOffer(randomUUID(), 'driver-1', 'user-1', 'ACCEPTED');
    expect(outcome.status).toBe('NOT_FOUND');
  });

  it('reports FORBIDDEN when the responding driver does not own the offer', async () => {
    const fixture = buildFixture();
    fixture.setLocations([NEAR]);
    const service = createDispatchService(fixture.deps);
    await service.advanceDispatch(fixture.orderId);
    const offer = fixture.offers[0];
    if (!offer) throw new Error('expected an offer');

    const outcome = await service.respondToOffer(offer.id, 'someone-else', 'user-1', 'ACCEPTED');
    expect(outcome.status).toBe('FORBIDDEN');
  });

  it('reports EXPIRED for an offer whose time has passed, and advances dispatch', async () => {
    const fixture = buildFixture();
    fixture.setLocations([NEAR]);
    const service = createDispatchService(fixture.deps);
    await service.advanceDispatch(fixture.orderId);
    const offer = fixture.offers[0];
    if (!offer) throw new Error('expected an offer');
    offer.expiresAt = new Date(Date.now() - 1000);
    fixture.setLocations([NEAR, NEARER]);

    const outcome = await service.respondToOffer(offer.id, offer.driverId, 'user-1', 'ACCEPTED');

    expect(outcome.status).toBe('EXPIRED');
    expect(offer.outcome).toBe('TIMEOUT');
    expect(fixture.offers).toHaveLength(2); // the timed-out one plus the next candidate
  });

  it('on ACCEPTED creates an assignment and transitions the order to ASSIGNED', async () => {
    const fixture = buildFixture();
    fixture.setLocations([NEAR]);
    const service = createDispatchService(fixture.deps);
    await service.advanceDispatch(fixture.orderId);
    const offer = fixture.offers[0];
    if (!offer) throw new Error('expected an offer');

    const outcome = await service.respondToOffer(offer.id, offer.driverId, 'user-1', 'ACCEPTED');

    expect(outcome.status).toBe('ACCEPTED');
    expect(fixture.assignments).toHaveLength(1);
    expect(fixture.assignments[0]?.driverId).toBe(offer.driverId);
    expect(fixture.lifecycleCalls).toContainEqual(
      expect.objectContaining({ orderId: fixture.orderId, to: 'ASSIGNED', actorType: 'DRIVER' })
    );
  });

  it('on DECLINED resolves the offer and immediately offers the next candidate', async () => {
    const fixture = buildFixture();
    fixture.setLocations([NEAR]);
    const service = createDispatchService(fixture.deps);
    await service.advanceDispatch(fixture.orderId);
    const offer = fixture.offers[0];
    if (!offer) throw new Error('expected an offer');
    fixture.setLocations([NEAR, NEARER]);

    const outcome = await service.respondToOffer(offer.id, offer.driverId, 'user-1', 'DECLINED');

    expect(outcome.status).toBe('DECLINED');
    expect(offer.outcome).toBe('DECLINED');
    expect(fixture.offers).toHaveLength(2);
    expect(fixture.offers[1]?.driverId).toBe('nearer');
  });

  it('reports ALREADY_RESOLVED for a second response to the same offer', async () => {
    const fixture = buildFixture();
    fixture.setLocations([NEAR]);
    const service = createDispatchService(fixture.deps);
    await service.advanceDispatch(fixture.orderId);
    const offer = fixture.offers[0];
    if (!offer) throw new Error('expected an offer');
    await service.respondToOffer(offer.id, offer.driverId, 'user-1', 'DECLINED');

    const outcome = await service.respondToOffer(offer.id, offer.driverId, 'user-1', 'ACCEPTED');
    expect(outcome.status).toBe('ALREADY_RESOLVED');
  });
});

describe('markPickedUp and markDelivered', () => {
  async function acceptedFixture() {
    const fixture = buildFixture();
    fixture.setLocations([NEAR]);
    const service = createDispatchService(fixture.deps);
    await service.advanceDispatch(fixture.orderId);
    const offer = fixture.offers[0];
    if (!offer) throw new Error('expected an offer');
    await service.respondToOffer(offer.id, offer.driverId, 'user-1', 'ACCEPTED');
    const assignment = fixture.assignments[0];
    if (!assignment) throw new Error('expected an assignment');
    return { fixture, service, assignment, driverId: offer.driverId };
  }

  it('reports NOT_FOUND for an unknown assignment', async () => {
    const { deps } = buildFixture();
    const service = createDispatchService(deps);
    const outcome = await service.markPickedUp(randomUUID(), 'driver-1', 'user-1');
    expect(outcome.status).toBe('NOT_FOUND');
  });

  it('reports FORBIDDEN when the driver does not own the assignment', async () => {
    const { service, assignment } = await acceptedFixture();
    const outcome = await service.markPickedUp(assignment.id, 'someone-else', 'user-1');
    expect(outcome.status).toBe('FORBIDDEN');
  });

  it('transitions the order to PICKED_UP for the owning driver', async () => {
    const { fixture, service, assignment, driverId } = await acceptedFixture();
    const outcome = await service.markPickedUp(assignment.id, driverId, 'user-1');

    expect(outcome.status).toBe('OK');
    expect(fixture.lifecycleCalls).toContainEqual(
      expect.objectContaining({ orderId: fixture.orderId, to: 'PICKED_UP', actorType: 'DRIVER' })
    );
  });

  it('completes the assignment on delivery, and not before', async () => {
    const { fixture, service, assignment, driverId } = await acceptedFixture();
    expect(assignment.completedAt).toBeNull();

    await service.markPickedUp(assignment.id, driverId, 'user-1');
    expect(assignment.completedAt).toBeNull();

    const outcome = await service.markDelivered(assignment.id, driverId, 'user-1');

    expect(outcome.status).toBe('OK');
    expect(assignment.completedAt).not.toBeNull();
    expect(fixture.lifecycleCalls).toContainEqual(
      expect.objectContaining({ orderId: fixture.orderId, to: 'DELIVERED', actorType: 'DRIVER' })
    );
  });

  it('reports ALREADY_COMPLETED for a second delivery confirmation', async () => {
    const { service, assignment, driverId } = await acceptedFixture();
    await service.markPickedUp(assignment.id, driverId, 'user-1');
    await service.markDelivered(assignment.id, driverId, 'user-1');

    const outcome = await service.markDelivered(assignment.id, driverId, 'user-1');
    expect(outcome.status).toBe('ALREADY_COMPLETED');
  });

  it('reports ILLEGAL_TRANSITION when the order state machine refuses the move', async () => {
    const { fixture, assignment, driverId } = await acceptedFixture();
    fixture.deps.lifecycle.transition = () =>
      Promise.resolve({ applied: false, reason: 'ILLEGAL_TRANSITION', from: 'ASSIGNED' } as never);
    const service = createDispatchService(fixture.deps);

    const outcome = await service.markPickedUp(assignment.id, driverId, 'user-1');

    expect(outcome.status).toBe('ILLEGAL_TRANSITION');
    expect(assignment.completedAt).toBeNull();
  });
});
