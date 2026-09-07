/**
 * Driver-facing dispatch actions (availability, location, offer response,
 * pickup/delivery confirmation) and the ops-facing view of orders dispatch
 * could not place. Authenticates against the 'customer' audience, same
 * reasoning as catalog and order's write routes: there is one login flow
 * for every human in this MVP, and role plus the driver-profile check
 * below decide what a caller may actually do.
 */

import { Router } from 'express';
import { driverAvailabilityUpdateSchema, driverLocationSchema } from '@omnes/contracts';
import {
  requireAuth,
  getDriverProfileForUser,
  type DriverProfileRecord,
  type TokenService,
} from '../identity/index.js';
import { requireRole } from '../../platform/rbac.js';
import { csrfProtection } from '../../platform/csrf.js';
import { conflict, forbidden, notFound, unauthorized } from '../../platform/errors.js';
import type { Actor } from '../../platform/actor.js';
import {
  setDriverOnline,
  setDriverOffline,
  recordDriverLocation,
} from './availability.repository.js';
import { findOpenOffersForDriver, type OfferRecord } from './offer.repository.js';
import { findOrdersAwaitingDispatch } from './decision.repository.js';
import type {
  AssignmentActionOutcome,
  DispatchService,
  RespondOutcome,
} from './dispatch.service.js';

async function requireApprovedDriver(actor: Actor): Promise<DriverProfileRecord> {
  const profile = await getDriverProfileForUser(actor.userId);
  if (!profile || profile.status !== 'APPROVED') {
    throw forbidden('NOT_AN_APPROVED_DRIVER', 'This action requires an approved driver profile.');
  }
  return profile;
}

function serializeOffer(offer: OfferRecord) {
  return {
    id: offer.id,
    orderId: offer.orderId,
    offeredAt: offer.offeredAt.toISOString(),
    expiresAt: offer.expiresAt.toISOString(),
  };
}

/** Called only after the route confirms outcome is not the success case it asked for. */
function respondOutcomeError(outcome: RespondOutcome) {
  switch (outcome.status) {
    case 'NOT_FOUND':
      return notFound('OFFER_NOT_FOUND', 'No offer matches this id.');
    case 'FORBIDDEN':
      return forbidden('FORBIDDEN', 'This offer was not made to you.');
    case 'EXPIRED':
      return conflict('OFFER_EXPIRED', 'This offer has already expired.');
    case 'ALREADY_RESOLVED':
      return conflict('OFFER_ALREADY_RESOLVED', 'This offer has already been responded to.');
    case 'ACCEPTED':
    case 'DECLINED':
      return new Error(`respondOutcomeError called with a success outcome: ${outcome.status}`);
  }
}

function assignmentOutcomeError(
  outcome: Extract<
    AssignmentActionOutcome,
    { status: 'NOT_FOUND' | 'FORBIDDEN' | 'ALREADY_COMPLETED' | 'ILLEGAL_TRANSITION' }
  >
) {
  switch (outcome.status) {
    case 'NOT_FOUND':
      return notFound('ASSIGNMENT_NOT_FOUND', 'No assignment matches this id.');
    case 'FORBIDDEN':
      return forbidden('FORBIDDEN', 'This assignment does not belong to you.');
    case 'ALREADY_COMPLETED':
      return conflict(
        'ASSIGNMENT_ALREADY_COMPLETED',
        'This assignment has already been completed.'
      );
    case 'ILLEGAL_TRANSITION':
      return conflict(
        'ILLEGAL_ORDER_TRANSITION',
        'The order cannot move to that status right now.'
      );
  }
}

export function createDispatchRouter(
  dispatch: DispatchService,
  tokenService: TokenService
): Router {
  const router = Router();
  router.use(requireAuth('customer', tokenService));
  router.use(csrfProtection('customer'));

  router.post('/availability', async (req, res) => {
    const actor = req.actor;
    if (!actor) throw unauthorized('UNAUTHENTICATED', 'Authentication required.');
    const driver = await requireApprovedDriver(actor);

    const input = driverAvailabilityUpdateSchema.parse(req.body);
    if (input.isOnline) {
      await setDriverOnline(driver.id, driver.vehicleType, input.currentZoneId);
    } else {
      await setDriverOffline(driver.id);
    }
    res.status(200).json({ isOnline: input.isOnline });
  });

  router.post('/location', async (req, res) => {
    const actor = req.actor;
    if (!actor) throw unauthorized('UNAUTHENTICATED', 'Authentication required.');
    const driver = await requireApprovedDriver(actor);

    const input = driverLocationSchema.parse(req.body);
    await recordDriverLocation(driver.id, input);
    res.status(204).send();
  });

  router.get('/offers', async (req, res) => {
    const actor = req.actor;
    if (!actor) throw unauthorized('UNAUTHENTICATED', 'Authentication required.');
    const driver = await requireApprovedDriver(actor);

    const openOffers = await findOpenOffersForDriver(driver.id);
    // Lazily advances each of this driver's open offers' orders before
    // answering, so polling this endpoint is also what notices one of
    // them just timed out - see dispatch.service.ts's advanceDispatch.
    await Promise.all(openOffers.map((offer) => dispatch.advanceDispatch(offer.orderId)));
    const current = await findOpenOffersForDriver(driver.id);

    res.status(200).json({ offers: current.map(serializeOffer) });
  });

  router.post('/offers/:id/accept', async (req, res) => {
    const actor = req.actor;
    if (!actor) throw unauthorized('UNAUTHENTICATED', 'Authentication required.');
    const driver = await requireApprovedDriver(actor);

    const outcome = await dispatch.respondToOffer(
      req.params.id,
      driver.id,
      actor.userId,
      'ACCEPTED'
    );
    if (outcome.status !== 'ACCEPTED') throw respondOutcomeError(outcome);
    res.status(200).json({ assignmentId: outcome.assignmentId });
  });

  router.post('/offers/:id/decline', async (req, res) => {
    const actor = req.actor;
    if (!actor) throw unauthorized('UNAUTHENTICATED', 'Authentication required.');
    const driver = await requireApprovedDriver(actor);

    const outcome = await dispatch.respondToOffer(
      req.params.id,
      driver.id,
      actor.userId,
      'DECLINED'
    );
    if (outcome.status !== 'DECLINED') throw respondOutcomeError(outcome);
    res.status(204).send();
  });

  router.post('/assignments/:id/picked-up', async (req, res) => {
    const actor = req.actor;
    if (!actor) throw unauthorized('UNAUTHENTICATED', 'Authentication required.');
    const driver = await requireApprovedDriver(actor);

    const outcome = await dispatch.markPickedUp(req.params.id, driver.id, actor.userId);
    if (outcome.status !== 'OK') throw assignmentOutcomeError(outcome);
    res.status(200).json({ status: 'PICKED_UP' });
  });

  router.post('/assignments/:id/delivered', async (req, res) => {
    const actor = req.actor;
    if (!actor) throw unauthorized('UNAUTHENTICATED', 'Authentication required.');
    const driver = await requireApprovedDriver(actor);

    const outcome = await dispatch.markDelivered(req.params.id, driver.id, actor.userId);
    if (outcome.status !== 'OK') throw assignmentOutcomeError(outcome);
    res.status(200).json({ status: 'DELIVERED' });
  });

  router.get('/needs-attention', requireRole('OPS', 'SUPER_ADMIN'), async (_req, res) => {
    const rows = await findOrdersAwaitingDispatch(50);
    res.status(200).json({
      items: rows.map((row) => ({
        orderId: row.orderId,
        orderNumber: row.orderNumber,
        merchantId: row.merchantId,
        placedAt: row.placedAt.toISOString(),
      })),
    });
  });

  return router;
}
