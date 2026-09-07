/**
 * Rate limiting. In-memory, via express-rate-limit's default store, which
 * is correct for one process but resets on restart and does not share state
 * across instances. That is an acceptable MVP tradeoff for a single API
 * instance; it becomes wrong the moment there is more than one, at which
 * point this needs a shared store (express-rate-limit supports a Redis
 * store behind the same interface, so the call sites below do not change).
 */

import rateLimit from 'express-rate-limit';
import type { Request, Response } from 'express';
import type { Config } from './config.js';
import { tooManyRequests } from './errors.js';

function jsonRateLimitHandler(code: string, message: string) {
  return (_req: Request, res: Response) => {
    const err = tooManyRequests(code, message);
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
  };
}

/** General ceiling applied to every route, ahead of any tighter per-route limit. */
export function generalRateLimiter(config: Config) {
  return rateLimit({
    windowMs: config.RATE_LIMIT_WINDOW_SECONDS * 1000,
    limit: config.RATE_LIMIT_MAX_REQUESTS,
    standardHeaders: true,
    legacyHeaders: false,
    handler: jsonRateLimitHandler('RATE_LIMITED', 'Too many requests. Please slow down.'),
  });
}

/**
 * Tighter limit for auth endpoints (OTP request, verify, refresh), keyed by
 * IP. This sits alongside the OTP service's own per-phone-number limit, not
 * in place of it: this one defends against a single client hammering the
 * endpoint across many phone numbers, which a per-phone limit alone cannot
 * catch.
 */
export function authRateLimiter(config: Config) {
  return rateLimit({
    windowMs: config.RATE_LIMIT_WINDOW_SECONDS * 1000,
    limit: config.RATE_LIMIT_AUTH_MAX_REQUESTS,
    standardHeaders: true,
    legacyHeaders: false,
    handler: jsonRateLimitHandler(
      'AUTH_RATE_LIMITED',
      'Too many authentication attempts. Please wait before trying again.'
    ),
  });
}
