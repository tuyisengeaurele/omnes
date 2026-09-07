/**
 * Ops-only driver provisioning. There is no driver self-signup in this MVP
 * - the driver app itself is out of scope (see docs/build-plan.md section
 * 9) - so an ops user provisions a driver for an existing account here, the
 * same shape catalog's merchant creation route uses for merchant owners.
 */

import { Router } from 'express';
import { provisionDriverSchema } from '@omnes/contracts';
import { csrfProtection } from '../../platform/csrf.js';
import { badRequest, unauthorized } from '../../platform/errors.js';
import { requireRole } from '../../platform/rbac.js';
import { requireAuth } from './authMiddleware.js';
import { createDriverProfile, findUserById, getDriverProfileForUser } from './repository.js';
import type { TokenService } from './token.service.js';

export function createDriverRouter(tokenService: TokenService): Router {
  const router = Router();
  router.use(requireAuth('customer', tokenService));
  router.use(csrfProtection('customer'));

  router.post('/', requireRole('OPS', 'SUPER_ADMIN'), async (req, res) => {
    if (!req.actor) throw unauthorized('UNAUTHENTICATED', 'Authentication required.');

    const input = provisionDriverSchema.parse(req.body);

    // Same ordering reasoning as catalog's merchant creation route: checked
    // before the write, not caught after, so a bad user id or a user who
    // is already a driver never gets halfway provisioned.
    const user = await findUserById(input.userId);
    if (!user) throw badRequest('USER_NOT_FOUND', 'No user matches userId.');
    const existingProfile = await getDriverProfileForUser(input.userId);
    if (existingProfile) {
      throw badRequest('USER_ALREADY_A_DRIVER', 'This user already has a driver profile.');
    }

    const profile = await createDriverProfile(input.userId, input.vehicleType);
    res.status(201).json({
      driver: {
        id: profile.id,
        userId: profile.userId,
        vehicleType: profile.vehicleType,
        status: profile.status,
      },
    });
  });

  return router;
}
