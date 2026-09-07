/**
 * Cookie naming and options for the three frontend surfaces.
 *
 * Cookies are not scoped by port, so customer-web, merchant-web, and
 * admin-web on localhost share one browser cookie jar in development. Each
 * surface gets its own cookie name here, and the JWT itself carries an
 * audience claim the server checks independently - so even if a cookie
 * somehow ended up in the wrong jar, the token inside it would still fail
 * verification for the wrong audience. See docs/build-plan.md section 1.2.
 */

import type { CookieOptions, Request, Response } from 'express';
import { randomBytes } from 'node:crypto';
import { AUDIENCE_SUFFIX, type Audience } from './audience.js';
import type { Config } from './config.js';

export function accessCookieName(audience: Audience): string {
  return `omnes_at_${AUDIENCE_SUFFIX[audience]}`;
}

export function refreshCookieName(audience: Audience): string {
  return `omnes_rt_${AUDIENCE_SUFFIX[audience]}`;
}

export function csrfCookieName(audience: Audience): string {
  return `omnes_csrf_${AUDIENCE_SUFFIX[audience]}`;
}

export const CSRF_HEADER_NAME = 'x-csrf-token';

function baseCookieOptions(config: Config): CookieOptions {
  const options: CookieOptions = {
    httpOnly: true,
    secure: config.COOKIE_SECURE,
    sameSite: 'strict',
    path: '/',
  };
  if (config.COOKIE_DOMAIN) options.domain = config.COOKIE_DOMAIN;
  return options;
}

export function generateCsrfToken(): string {
  return randomBytes(32).toString('base64url');
}

export interface SessionCookiePayload {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
}

/**
 * Sets the access, refresh, and CSRF cookies for one login or rotation. The
 * CSRF cookie is deliberately not httpOnly: the double-submit pattern needs
 * client JavaScript to read it and echo it back in a request header, which
 * is what proves the request came from a page that could read this origin's
 * cookies rather than from a cross-site form or image tag.
 */
export function setSessionCookies(
  res: Response,
  audience: Audience,
  tokens: SessionCookiePayload,
  config: Config
): string {
  const base = baseCookieOptions(config);

  res.cookie(accessCookieName(audience), tokens.accessToken, {
    ...base,
    maxAge: config.JWT_ACCESS_TTL_SECONDS * 1000,
  });

  res.cookie(refreshCookieName(audience), tokens.refreshToken, {
    ...base,
    maxAge: tokens.refreshExpiresAt.getTime() - Date.now(),
  });

  const csrfToken = generateCsrfToken();
  res.cookie(csrfCookieName(audience), csrfToken, {
    ...base,
    httpOnly: false,
    maxAge: tokens.refreshExpiresAt.getTime() - Date.now(),
  });

  return csrfToken;
}

export function clearSessionCookies(res: Response, audience: Audience, config: Config): void {
  const base = baseCookieOptions(config);
  res.clearCookie(accessCookieName(audience), base);
  res.clearCookie(refreshCookieName(audience), base);
  res.clearCookie(csrfCookieName(audience), { ...base, httpOnly: false });
}

export function readAccessCookie(req: Request, audience: Audience): string | undefined {
  const cookies = req.cookies as Record<string, string | undefined> | undefined;
  return cookies?.[accessCookieName(audience)];
}

export function readRefreshCookie(req: Request, audience: Audience): string | undefined {
  const cookies = req.cookies as Record<string, string | undefined> | undefined;
  return cookies?.[refreshCookieName(audience)];
}

export function readCsrfCookie(req: Request, audience: Audience): string | undefined {
  const cookies = req.cookies as Record<string, string | undefined> | undefined;
  return cookies?.[csrfCookieName(audience)];
}
