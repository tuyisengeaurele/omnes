/**
 * Customer-facing auth routes: register, login, refresh, logout, and the
 * current session. Phone-plus-OTP self-registration is specific to
 * customers - FR-AUTH-004 puts drivers and merchants through a distinct
 * onboarding and verification flow, not this one - so this router always
 * operates on the 'customer' audience rather than taking it as a parameter.
 */

import { Router } from 'express';
import { loginSchema, registerSchema, requestOtpSchema } from '@omnes/contracts';
import { readRefreshCookie, clearSessionCookies, setSessionCookies } from '../../platform/cookies.js';
import { badRequest, tooManyRequests, unauthorized } from '../../platform/errors.js';
import { authRateLimiter } from '../../platform/rateLimit.js';
import { csrfProtection } from '../../platform/csrf.js';
import type { Config } from '../../platform/config.js';
import type { AuthService } from './auth.service.js';
import type { TokenService } from './token.service.js';
import { requireAuth } from './authMiddleware.js';
import { findUserById } from './repository.js';

const AUDIENCE = 'customer';

export function createIdentityRouter(
  authService: AuthService,
  tokenService: TokenService,
  config: Config
): Router {
  const router = Router();
  const authLimiter = authRateLimiter(config);

  function userResponse(user: {
    id: string;
    phoneE164: string | null;
    displayName: string;
    locale: string;
  }) {
    return {
      id: user.id,
      phoneE164: user.phoneE164,
      displayName: user.displayName,
      locale: user.locale,
    };
  }

  router.post('/register/request-otp', authLimiter, async (req, res) => {
    const input = requestOtpSchema.parse(req.body);
    const outcome = await authService.requestRegistrationOtp(input.phoneE164);

    if (!outcome.ok) {
      if (outcome.reason === 'RATE_LIMITED') {
        throw tooManyRequests(
          'OTP_RATE_LIMITED',
          'Too many codes requested for this number. Please wait before trying again.',
          outcome.retryAfterSeconds
        );
      }
      throw badRequest('ALREADY_REGISTERED', 'An account with this phone number already exists.');
    }

    res.status(202).json({ status: 'otp_sent' });
  });

  router.post('/register/verify', authLimiter, async (req, res) => {
    const input = registerSchema.parse(req.body);
    const outcome = await authService.completeRegistration(
      input.phoneE164,
      input.displayName,
      input.code
    );

    if (!outcome.ok) {
      throw badRequest('REGISTRATION_FAILED', registrationFailureMessage(outcome.reason), {
        reason: outcome.reason,
      });
    }

    const csrfToken = setSessionCookies(res, AUDIENCE, outcome.result.tokens, config);
    res.status(201).json({ user: userResponse(outcome.result.user), csrfToken });
  });

  router.post('/login/request-otp', authLimiter, async (req, res) => {
    const input = requestOtpSchema.parse(req.body);
    const outcome = await authService.requestLoginOtp(input.phoneE164);

    if (!outcome.ok && outcome.reason === 'RATE_LIMITED') {
      throw tooManyRequests(
        'OTP_RATE_LIMITED',
        'Too many codes requested for this number. Please wait before trying again.',
        outcome.retryAfterSeconds
      );
    }

    // Whether or not this number has an account, the response is identical.
    // See the file header on why registration status is not treated as a
    // hard secret here - but there is still no reason to hand a client two
    // differently-shaped responses to branch on for the same user action,
    // and there is no code to send for a number with no account regardless.
    res.status(202).json({ status: 'otp_sent' });
  });

  router.post('/login/verify', authLimiter, async (req, res) => {
    const input = loginSchema.parse(req.body);
    const outcome = await authService.completeLogin(input.phoneE164, input.code);

    if (!outcome.ok) {
      throw badRequest('LOGIN_FAILED', loginFailureMessage(outcome.reason), {
        reason: outcome.reason,
      });
    }

    const csrfToken = setSessionCookies(res, AUDIENCE, outcome.result.tokens, config);
    res.status(200).json({ user: userResponse(outcome.result.user), csrfToken });
  });

  router.post('/refresh', authLimiter, csrfProtection(AUDIENCE), async (req, res) => {
    const presented = readRefreshCookie(req, AUDIENCE);
    if (!presented) throw unauthorized('NO_SESSION', 'No session to refresh.');

    const outcome = await authService.refreshSession(presented);
    if (!outcome.ok) {
      clearSessionCookies(res, AUDIENCE, config);
      throw unauthorized(
        'SESSION_INVALID',
        'Session is invalid or has expired. Please log in again.'
      );
    }

    const csrfToken = setSessionCookies(res, AUDIENCE, outcome.tokens, config);
    res.status(200).json({ csrfToken });
  });

  router.post('/logout', csrfProtection(AUDIENCE), async (req, res) => {
    const presented = readRefreshCookie(req, AUDIENCE);
    if (presented) await authService.logout(presented);
    clearSessionCookies(res, AUDIENCE, config);
    res.status(204).send();
  });

  router.get('/me', requireAuth(AUDIENCE, tokenService), async (req, res) => {
    const actor = req.actor;
    if (!actor) throw unauthorized('UNAUTHENTICATED', 'Authentication required.');

    const user = await findUserById(actor.userId);
    if (!user) throw unauthorized('SESSION_INVALID', 'Session no longer matches an account.');

    res.status(200).json({ user: userResponse(user), roles: actor.roles });
  });

  return router;
}

function registrationFailureMessage(reason: string): string {
  switch (reason) {
    case 'ALREADY_REGISTERED':
      return 'An account with this phone number already exists.';
    case 'EXPIRED':
      return 'That code has expired. Please request a new one.';
    case 'ALREADY_CONSUMED':
      return 'That code has already been used. Please request a new one.';
    case 'MAX_ATTEMPTS_EXCEEDED':
      return 'Too many incorrect attempts. Please request a new code.';
    case 'NOT_FOUND':
      return 'No verification code was requested for this number.';
    default:
      return 'That code is incorrect.';
  }
}

function loginFailureMessage(reason: string): string {
  switch (reason) {
    case 'NOT_REGISTERED':
      return 'No account exists for this phone number.';
    case 'EXPIRED':
      return 'That code has expired. Please request a new one.';
    case 'ALREADY_CONSUMED':
      return 'That code has already been used. Please request a new one.';
    case 'MAX_ATTEMPTS_EXCEEDED':
      return 'Too many incorrect attempts. Please request a new code.';
    case 'NOT_FOUND':
      return 'No verification code was requested for this number.';
    default:
      return 'That code is incorrect.';
  }
}
