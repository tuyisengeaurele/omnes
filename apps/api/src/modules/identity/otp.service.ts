/**
 * OTP issue and verification. Pure business logic: this file never imports
 * Prisma. Persistence is injected as an OtpStore, which is what lets the
 * security-critical paths here (expiry, replay, brute-force lockout, rate
 * limiting) be unit tested against a fake in-memory store instead of a live
 * database - fast, deterministic, and exercised on every run rather than
 * only when a Postgres instance happens to be reachable.
 *
 * OTP codes are hashed with HMAC-SHA256 keyed by a server-side pepper, never
 * stored or logged in plaintext. See docs/build-plan.md section 1.2 and the
 * security checklist for why a plain hash is not enough against a 6-digit
 * numeric keyspace.
 */

import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

export type OtpPurpose = 'REGISTER' | 'LOGIN' | 'ACCOUNT_RECOVERY';

export interface OtpChallengeRecord {
  id: string;
  phoneE164: string;
  codeHash: string;
  purpose: string;
  attempts: number;
  expiresAt: Date;
  consumedAt: Date | null;
  createdAt: Date;
}

/**
 * Persistence seam. A Prisma-backed implementation lives in otp.store.ts;
 * tests substitute an in-memory fake.
 */
export interface OtpStore {
  create(input: {
    phoneE164: string;
    codeHash: string;
    purpose: OtpPurpose;
    expiresAt: Date;
  }): Promise<OtpChallengeRecord>;
  /** Most recent challenge for this phone and purpose, of any status. */
  findLatest(phoneE164: string, purpose: OtpPurpose): Promise<OtpChallengeRecord | null>;
  incrementAttempts(id: string): Promise<void>;
  markConsumed(id: string, consumedAt: Date): Promise<void>;
  /** Count of challenges created for this phone, across every purpose, since the given time. */
  countSince(phoneE164: string, since: Date): Promise<number>;
}

export interface OtpServiceDeps {
  store: OtpStore;
  /** HMAC key. Never the same secret used to sign JWTs. */
  pepper: string;
  ttlSeconds: number;
  codeLength: number;
  maxAttempts: number;
  requestsPerHour: number;
  /** Injectable clock, so tests can move time without a real sleep. */
  now?: () => Date;
}

export interface IssueOtpResult {
  challengeId: string;
  /**
   * The plaintext code. The caller must hand this to an SmsPort adapter and
   * must never log it - see the redact config in platform/logger.ts, which
   * only protects fields that pass through the logger. A console.log of
   * this value bypasses that entirely.
   */
  code: string;
  expiresAt: Date;
}

export type IssueOtpOutcome =
  | { ok: true; result: IssueOtpResult }
  | { ok: false; reason: 'RATE_LIMITED'; retryAfterSeconds: number };

export type VerifyOtpOutcome =
  | { ok: true }
  | {
      ok: false;
      reason: 'NOT_FOUND' | 'EXPIRED' | 'ALREADY_CONSUMED' | 'MAX_ATTEMPTS_EXCEEDED' | 'INCORRECT_CODE';
    };

/**
 * Derived from VerifyOtpOutcome rather than redeclared, so a new failure
 * reason added there is automatically available to callers here - a route
 * or the auth service that wants to report the specific reason to the user
 * cannot silently fall out of sync with what verify() can actually return.
 */
export type VerifyOtpFailureReason = Extract<VerifyOtpOutcome, { ok: false }>['reason'];

export function hashOtpCode(code: string, pepper: string): string {
  return createHmac('sha256', pepper).update(code).digest('hex');
}

/** Constant-time comparison, so a timing difference cannot leak how much of a guess was correct. */
function codeMatches(code: string, pepper: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashOtpCode(code, pepper), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

function generateCode(length: number): string {
  const max = 10 ** length;
  return randomInt(0, max).toString().padStart(length, '0');
}

export function createOtpService(deps: OtpServiceDeps) {
  const now = deps.now ?? (() => new Date());

  async function issue(phoneE164: string, purpose: OtpPurpose): Promise<IssueOtpOutcome> {
    const windowStart = new Date(now().getTime() - 60 * 60 * 1000);
    const recentCount = await deps.store.countSince(phoneE164, windowStart);

    if (recentCount >= deps.requestsPerHour) {
      // The exact rollover time would need the oldest request's timestamp,
      // which countSince does not return. A flat window is conservative
      // (never under-reports the wait) and simple; refine only if product
      // feedback says the UX needs the precise figure.
      return { ok: false, reason: 'RATE_LIMITED', retryAfterSeconds: 60 * 60 };
    }

    const code = generateCode(deps.codeLength);
    const expiresAt = new Date(now().getTime() + deps.ttlSeconds * 1000);

    const record = await deps.store.create({
      phoneE164,
      codeHash: hashOtpCode(code, deps.pepper),
      purpose,
      expiresAt,
    });

    return { ok: true, result: { challengeId: record.id, code, expiresAt } };
  }

  async function verify(
    phoneE164: string,
    purpose: OtpPurpose,
    code: string
  ): Promise<VerifyOtpOutcome> {
    const latest = await deps.store.findLatest(phoneE164, purpose);
    if (!latest) return { ok: false, reason: 'NOT_FOUND' };
    if (latest.consumedAt) return { ok: false, reason: 'ALREADY_CONSUMED' };
    if (latest.attempts >= deps.maxAttempts) {
      return { ok: false, reason: 'MAX_ATTEMPTS_EXCEEDED' };
    }
    if (now().getTime() > latest.expiresAt.getTime()) {
      return { ok: false, reason: 'EXPIRED' };
    }

    if (!codeMatches(code, deps.pepper, latest.codeHash)) {
      await deps.store.incrementAttempts(latest.id);
      return { ok: false, reason: 'INCORRECT_CODE' };
    }

    await deps.store.markConsumed(latest.id, now());
    return { ok: true };
  }

  return { issue, verify };
}

export type OtpService = ReturnType<typeof createOtpService>;
