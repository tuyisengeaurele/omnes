/**
 * Verifies the access token cookie for one audience and populates
 * req.actor. Every merchant and admin route sits behind this plus
 * requireRole from platform/rbac.ts; this alone only proves who the caller
 * is, not what they are allowed to do.
 */

import type { NextFunction, Request, Response } from 'express';
import type { Audience } from '../../platform/audience.js';
import { readAccessCookie } from '../../platform/cookies.js';
import { unauthorized } from '../../platform/errors.js';
import type { TokenService } from './token.service.js';

export function requireAuth(
  audience: Audience,
  tokenService: Pick<TokenService, 'verifyAccessToken'>
) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const token = readAccessCookie(req, audience);
    if (!token) {
      next(unauthorized('UNAUTHENTICATED', 'Authentication required.'));
      return;
    }

    const result = await tokenService.verifyAccessToken(token, audience);
    if (!result.ok) {
      next(unauthorized('UNAUTHENTICATED', 'Session is invalid or has expired.'));
      return;
    }

    req.actor = { userId: result.claims.sub, audience, roles: result.claims.roles };
    next();
  };
}
