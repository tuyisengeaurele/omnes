/**
 * Access and refresh token issuance, verification, and rotation.
 *
 * Access tokens are short-lived JWTs carrying an audience claim, per
 * docs/build-plan.md section 1.2: three frontends share one browser cookie
 * jar in development, so a customer token replayed against `/api/admin/*`
 * must fail on audience before it ever reaches an RBAC check.
 *
 * Refresh tokens are opaque 256-bit random values, stored hashed. Rotation
 * is where the actual security guarantee lives: every refresh consumes the
 * presented token and issues a new one in the same family. If an
 * already-consumed token is ever presented again, that can only mean it was
 * copied and used by someone else, so the entire family - every token that
 * ever descended from that login - is revoked at once.
 *
 * This file has no Prisma import. Persistence is injected as a
 * RefreshTokenStore; token.store.ts holds the Prisma-backed implementation.
 */

import { randomBytes, createHash, randomUUID } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { JOSEError, JWTExpired, JWTClaimValidationFailed } from 'jose/errors';

export type Audience = 'customer' | 'merchant' | 'admin';

export interface RefreshTokenRecord {
  id: string;
  userId: string;
  tokenHash: string;
  familyId: string;
  audience: string;
  expiresAt: Date;
  rotatedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

/** Persistence seam. Prisma-backed implementation in token.store.ts. */
export interface RefreshTokenStore {
  create(input: {
    userId: string;
    tokenHash: string;
    familyId: string;
    audience: Audience;
    expiresAt: Date;
  }): Promise<RefreshTokenRecord>;
  findByHash(tokenHash: string): Promise<RefreshTokenRecord | null>;
  /** Marks one token consumed by rotation: both revoked and rotated at the given time. */
  markRotated(id: string, at: Date): Promise<void>;
  /** Revokes every token descended from the same login, because reuse means the chain is compromised. */
  revokeFamily(familyId: string, at: Date): Promise<void>;
}

export interface AccessTokenClaims {
  sub: string;
  aud: Audience;
  roles: string[];
}

export interface IssuedTokens {
  accessToken: string;
  /** Plaintext. The caller sets this as an httpOnly cookie and never logs it. */
  refreshToken: string;
  refreshExpiresAt: Date;
}

export type RefreshOutcome =
  | { ok: true; tokens: IssuedTokens; userId: string; audience: Audience }
  | { ok: false; reason: 'INVALID' | 'EXPIRED' | 'REUSE_DETECTED' };

export type VerifyAccessOutcome =
  | { ok: true; claims: AccessTokenClaims }
  | { ok: false; reason: 'INVALID' | 'EXPIRED' | 'WRONG_AUDIENCE' };

export interface TokenServiceDeps {
  refreshStore: RefreshTokenStore;
  accessSecret: string;
  accessTtlSeconds: number;
  refreshTtlDays: number;
  now?: () => Date;
}

export function hashRefreshToken(token: string): string {
  // Plain SHA-256, no pepper. Unlike the OTP's 6-digit keyspace, a 256-bit
  // random value is not brute-forceable from its hash regardless of a
  // pepper; the pepper on OTP hashing exists specifically to compensate for
  // a small keyspace, which does not apply here.
  return createHash('sha256').update(token).digest('hex');
}

function generateRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

async function signAccessToken(
  claims: AccessTokenClaims,
  secret: string,
  ttlSeconds: number,
  now: Date
): Promise<string> {
  const key = new TextEncoder().encode(secret);
  return new SignJWT({ roles: claims.roles })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setAudience(claims.aud)
    .setIssuedAt(now)
    .setExpirationTime(new Date(now.getTime() + ttlSeconds * 1000))
    .sign(key);
}

export function createTokenService(deps: TokenServiceDeps) {
  const now = deps.now ?? (() => new Date());

  async function issueTokenPair(
    userId: string,
    audience: Audience,
    roles: string[],
    familyId: string
  ): Promise<IssuedTokens> {
    const at = now();
    const accessToken = await signAccessToken(
      { sub: userId, aud: audience, roles },
      deps.accessSecret,
      deps.accessTtlSeconds,
      at
    );

    const refreshToken = generateRefreshToken();
    const refreshExpiresAt = new Date(at.getTime() + deps.refreshTtlDays * 24 * 60 * 60 * 1000);

    await deps.refreshStore.create({
      userId,
      tokenHash: hashRefreshToken(refreshToken),
      familyId,
      audience,
      expiresAt: refreshExpiresAt,
    });

    return { accessToken, refreshToken, refreshExpiresAt };
  }

  /** Login or registration: starts a brand new token family. */
  async function issueSession(
    userId: string,
    audience: Audience,
    roles: string[]
  ): Promise<IssuedTokens> {
    return issueTokenPair(userId, audience, roles, randomUUID());
  }

  /**
   * Consumes a refresh token and issues a new pair in the same family.
   * `rolesForUser` is called only once the presented token is confirmed
   * valid, so a rotation never grants roles based on stale claims - the
   * caller looks the user's current roles up fresh from the database.
   */
  async function refresh(
    presentedToken: string,
    rolesForUser: (userId: string) => Promise<string[]>
  ): Promise<RefreshOutcome> {
    const tokenHash = hashRefreshToken(presentedToken);
    const record = await deps.refreshStore.findByHash(tokenHash);

    if (!record) return { ok: false, reason: 'INVALID' };

    if (record.revokedAt) {
      // A revoked token being presented again is the signal that it leaked:
      // whoever legitimately rotated it already moved on to the next token
      // in the chain, so this presentation can only be a replay.
      await deps.refreshStore.revokeFamily(record.familyId, now());
      return { ok: false, reason: 'REUSE_DETECTED' };
    }

    if (record.expiresAt.getTime() < now().getTime()) {
      return { ok: false, reason: 'EXPIRED' };
    }

    await deps.refreshStore.markRotated(record.id, now());

    const audience = record.audience as Audience;
    const roles = await rolesForUser(record.userId);
    const tokens = await issueTokenPair(record.userId, audience, roles, record.familyId);

    return { ok: true, tokens, userId: record.userId, audience };
  }

  /** Logout: ends every token descended from this login, on this device. */
  async function revokeSession(presentedToken: string): Promise<void> {
    const record = await deps.refreshStore.findByHash(hashRefreshToken(presentedToken));
    if (record) await deps.refreshStore.revokeFamily(record.familyId, now());
  }

  async function verifyAccessToken(
    token: string,
    expectedAudience: Audience
  ): Promise<VerifyAccessOutcome> {
    try {
      const key = new TextEncoder().encode(deps.accessSecret);
      const { payload } = await jwtVerify(token, key, { audience: expectedAudience });

      if (typeof payload.sub !== 'string') return { ok: false, reason: 'INVALID' };
      const roles = Array.isArray(payload['roles']) ? (payload['roles'] as string[]) : [];

      return {
        ok: true,
        claims: { sub: payload.sub, aud: expectedAudience, roles },
      };
    } catch (err) {
      if (err instanceof JWTExpired) return { ok: false, reason: 'EXPIRED' };
      if (err instanceof JWTClaimValidationFailed && err.claim === 'aud') {
        return { ok: false, reason: 'WRONG_AUDIENCE' };
      }
      // Every other jose failure - a malformed token, a bad signature, any
      // other claim mismatch - is just "not a valid token" from the caller's
      // point of view. Falling back to the JOSEError base class here, rather
      // than listing every concrete subclass, means a jose error type this
      // code was not written against still gets classified as INVALID
      // instead of crashing the request.
      if (err instanceof JOSEError) return { ok: false, reason: 'INVALID' };
      throw err;
    }
  }

  return { issueSession, refresh, revokeSession, verifyAccessToken };
}

export type TokenService = ReturnType<typeof createTokenService>;
