/**
 * Double-submit CSRF check. SameSite=Strict on every session cookie is the
 * first line of defense; this is the second, so a single browser quirk or a
 * SameSite downgrade is not the only thing standing between a cross-site
 * form and a state-changing request. See docs/build-plan.md section 1.2.
 *
 * GET, HEAD, and OPTIONS are exempt: they must not have side effects (and
 * nothing in this codebase gives them any), so there is nothing here for
 * CSRF to protect.
 */

import type { NextFunction, Request, Response } from 'express';
import { timingSafeEqual } from 'node:crypto';
import type { Audience } from './audience.js';
import { CSRF_HEADER_NAME, readCsrfCookie } from './cookies.js';
import { forbidden } from './errors.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function csrfProtection(audience: Audience) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (SAFE_METHODS.has(req.method)) {
      next();
      return;
    }

    const cookieToken = readCsrfCookie(req, audience);
    const headerToken = req.header(CSRF_HEADER_NAME);

    if (!cookieToken || !headerToken || !safeEqual(cookieToken, headerToken)) {
      next(forbidden('CSRF_TOKEN_INVALID', 'Missing or invalid CSRF token.'));
      return;
    }

    next();
  };
}
