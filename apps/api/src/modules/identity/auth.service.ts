/**
 * Orchestrates registration, login, refresh, and logout: OTP issue/verify,
 * user creation, and token issuance. The branching security logic (OTP
 * rules, token rotation) lives in otp.service.ts and token.service.ts,
 * already unit tested there; this file is mostly glue, exercised by the
 * route integration tests against the real stack instead.
 *
 * Whether "phone already registered" is safe to reveal is a real product
 * decision, not an oversight: unlike an email address, a phone number here
 * is not treated as sensitive across unrelated services, and the market
 * this ships to (mobile-money-first, phone-number-as-identity) expects a
 * registration flow to say "you already have an account, log in instead"
 * rather than silently issuing a code to a number that cannot use it.
 */

import {
  createCustomerFromVerifiedPhone,
  findUserByPhone,
  getRolesForUser,
  type UserRecord,
} from './repository.js';
import type { OtpService, VerifyOtpFailureReason } from './otp.service.js';
import type { IssuedTokens, RefreshOutcome, TokenService } from './token.service.js';
import type { SmsPort } from '../../adapters/sms/index.js';

export interface AuthServiceDeps {
  otpService: OtpService;
  tokenService: TokenService;
  smsPort: SmsPort;
}

export interface SessionResult {
  tokens: IssuedTokens;
  user: UserRecord;
}

export type RequestOtpOutcome =
  | { ok: true }
  | { ok: false; reason: 'RATE_LIMITED'; retryAfterSeconds: number };

export type RequestRegistrationOtpOutcome =
  | RequestOtpOutcome
  | { ok: false; reason: 'ALREADY_REGISTERED' };

export type RequestLoginOtpOutcome = RequestOtpOutcome | { ok: false; reason: 'NOT_REGISTERED' };

export type CompleteRegistrationOutcome =
  | { ok: true; result: SessionResult }
  | { ok: false; reason: VerifyOtpFailureReason | 'ALREADY_REGISTERED' };

export type CompleteLoginOutcome =
  | { ok: true; result: SessionResult }
  | { ok: false; reason: VerifyOtpFailureReason | 'NOT_REGISTERED' };

function otpMessage(code: string, ttlMinutes: number): string {
  return `Your Omnes verification code is ${code}. It expires in ${ttlMinutes} minutes.`;
}

export function createAuthService(deps: AuthServiceDeps) {
  async function requestRegistrationOtp(phoneE164: string): Promise<RequestRegistrationOtpOutcome> {
    const existing = await findUserByPhone(phoneE164);
    if (existing) return { ok: false, reason: 'ALREADY_REGISTERED' };

    const issued = await deps.otpService.issue(phoneE164, 'REGISTER');
    if (!issued.ok) return issued;

    await deps.smsPort.send({
      to: phoneE164,
      body: otpMessage(issued.result.code, Math.round((issued.result.expiresAt.getTime() - Date.now()) / 60000)),
    });
    return { ok: true };
  }

  async function requestLoginOtp(phoneE164: string): Promise<RequestLoginOtpOutcome> {
    const existing = await findUserByPhone(phoneE164);
    if (!existing) return { ok: false, reason: 'NOT_REGISTERED' };

    const issued = await deps.otpService.issue(phoneE164, 'LOGIN');
    if (!issued.ok) return issued;

    await deps.smsPort.send({
      to: phoneE164,
      body: otpMessage(issued.result.code, Math.round((issued.result.expiresAt.getTime() - Date.now()) / 60000)),
    });
    return { ok: true };
  }

  async function completeRegistration(
    phoneE164: string,
    displayName: string,
    code: string
  ): Promise<CompleteRegistrationOutcome> {
    const verified = await deps.otpService.verify(phoneE164, 'REGISTER', code);
    if (!verified.ok) return { ok: false, reason: verified.reason };

    // Re-checked here even though requestRegistrationOtp already checked:
    // two registration attempts for the same number can race between issue
    // and verify, and the unique constraint on User.phoneE164 is the real
    // backstop, but this avoids surfacing a confusing database error to
    // whichever request loses the race.
    const existing = await findUserByPhone(phoneE164);
    if (existing) return { ok: false, reason: 'ALREADY_REGISTERED' };

    const user = await createCustomerFromVerifiedPhone(phoneE164, displayName);
    const roles = await getRolesForUser(user.id);
    const tokens = await deps.tokenService.issueSession(user.id, 'customer', roles);
    return { ok: true, result: { tokens, user } };
  }

  async function completeLogin(phoneE164: string, code: string): Promise<CompleteLoginOutcome> {
    const verified = await deps.otpService.verify(phoneE164, 'LOGIN', code);
    if (!verified.ok) return { ok: false, reason: verified.reason };

    const user = await findUserByPhone(phoneE164);
    if (!user) return { ok: false, reason: 'NOT_REGISTERED' };

    const roles = await getRolesForUser(user.id);
    const tokens = await deps.tokenService.issueSession(user.id, 'customer', roles);
    return { ok: true, result: { tokens, user } };
  }

  async function refreshSession(refreshToken: string): Promise<RefreshOutcome> {
    return deps.tokenService.refresh(refreshToken, (userId) => getRolesForUser(userId));
  }

  async function logout(refreshToken: string): Promise<void> {
    await deps.tokenService.revokeSession(refreshToken);
  }

  return {
    requestRegistrationOtp,
    requestLoginOtp,
    completeRegistration,
    completeLogin,
    refreshSession,
    logout,
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
