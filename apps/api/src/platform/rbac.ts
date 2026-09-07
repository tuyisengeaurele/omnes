/**
 * Server-side role check. The frontend hiding a button is not a security
 * boundary; this is. Every merchant and admin route must sit behind this,
 * not just behind requireAuth, since requireAuth only proves who the caller
 * is, not what they are allowed to do.
 */

import type { NextFunction, Request, Response } from 'express';
import { forbidden, unauthorized } from './errors.js';

export function requireRole(...allowedRoles: string[]) {
  const allowed = new Set(allowedRoles);

  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.actor) {
      // requireAuth did not run before this, or the request genuinely has
      // no session. Either way this is a 401 (who are you), not a 403
      // (I know who you are and the answer is no).
      next(unauthorized('UNAUTHENTICATED', 'Authentication required.'));
      return;
    }

    const hasRole = req.actor.roles.some((role) => allowed.has(role));
    if (!hasRole) {
      next(forbidden('FORBIDDEN', 'You do not have permission to perform this action.'));
      return;
    }

    next();
  };
}
