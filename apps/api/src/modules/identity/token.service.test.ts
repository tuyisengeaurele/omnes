import { beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  createTokenService,
  hashRefreshToken,
  type Audience,
  type RefreshTokenRecord,
  type RefreshTokenStore,
} from './token.service.js';

class FakeRefreshTokenStore implements RefreshTokenStore {
  records: RefreshTokenRecord[] = [];

  async create(input: {
    userId: string;
    tokenHash: string;
    familyId: string;
    audience: Audience;
    expiresAt: Date;
  }): Promise<RefreshTokenRecord> {
    const record: RefreshTokenRecord = {
      id: randomUUID(),
      userId: input.userId,
      tokenHash: input.tokenHash,
      familyId: input.familyId,
      audience: input.audience,
      expiresAt: input.expiresAt,
      rotatedAt: null,
      revokedAt: null,
      createdAt: new Date(),
    };
    this.records.push(record);
    return record;
  }

  async findByHash(tokenHash: string): Promise<RefreshTokenRecord | null> {
    return this.records.find((r) => r.tokenHash === tokenHash) ?? null;
  }

  async markRotated(id: string, at: Date): Promise<void> {
    const record = this.records.find((r) => r.id === id);
    if (record) {
      record.rotatedAt = at;
      record.revokedAt = at;
    }
  }

  async revokeFamily(familyId: string, at: Date): Promise<void> {
    for (const record of this.records) {
      if (record.familyId === familyId && !record.revokedAt) record.revokedAt = at;
    }
  }
}

const SECRET = 'x'.repeat(32);
const USER_ID = 'user-1';

function buildService(store: FakeRefreshTokenStore, overrides: { now?: () => Date } = {}) {
  return createTokenService({
    refreshStore: store,
    accessSecret: SECRET,
    accessTtlSeconds: 900,
    refreshTtlDays: 30,
    ...overrides,
  });
}

describe('token service', () => {
  let store: FakeRefreshTokenStore;

  beforeEach(() => {
    store = new FakeRefreshTokenStore();
  });

  describe('issueSession and verifyAccessToken', () => {
    it('issues an access token verifiable for the audience it was issued for', async () => {
      const service = buildService(store);
      const tokens = await service.issueSession(USER_ID, 'customer', ['CUSTOMER']);
      const result = await service.verifyAccessToken(tokens.accessToken, 'customer');
      expect(result).toEqual({
        ok: true,
        claims: { sub: USER_ID, aud: 'customer', roles: ['CUSTOMER'] },
      });
    });

    it('rejects a token presented against a different audience than it was issued for', async () => {
      const service = buildService(store);
      const tokens = await service.issueSession(USER_ID, 'customer', ['CUSTOMER']);
      // This is the cross-audience replay scenario from the build plan: a
      // customer token must not authenticate an admin route.
      const result = await service.verifyAccessToken(tokens.accessToken, 'admin');
      expect(result).toEqual({ ok: false, reason: 'WRONG_AUDIENCE' });
    });

    it('rejects an expired access token', async () => {
      let clock = new Date('2026-01-01T00:00:00Z');
      const service = buildService(store, { now: () => clock });
      const tokens = await service.issueSession(USER_ID, 'merchant', ['MERCHANT_OWNER']);

      clock = new Date(clock.getTime() + 901 * 1000);
      const result = await service.verifyAccessToken(tokens.accessToken, 'merchant');
      expect(result).toEqual({ ok: false, reason: 'EXPIRED' });
    });

    it('rejects a garbage token', async () => {
      const service = buildService(store);
      const result = await service.verifyAccessToken('not.a.jwt', 'customer');
      expect(result).toEqual({ ok: false, reason: 'INVALID' });
    });

    it('rejects a token signed with a different secret', async () => {
      const serviceA = buildService(store);
      const otherStore = new FakeRefreshTokenStore();
      const serviceB = createTokenService({
        refreshStore: otherStore,
        accessSecret: 'y'.repeat(32),
        accessTtlSeconds: 900,
        refreshTtlDays: 30,
      });
      const tokens = await serviceB.issueSession(USER_ID, 'customer', ['CUSTOMER']);
      const result = await serviceA.verifyAccessToken(tokens.accessToken, 'customer');
      expect(result).toEqual({ ok: false, reason: 'INVALID' });
    });

    it('starts each new session in its own token family', async () => {
      const service = buildService(store);
      await service.issueSession(USER_ID, 'customer', ['CUSTOMER']);
      await service.issueSession(USER_ID, 'customer', ['CUSTOMER']);
      const families = new Set(store.records.map((r) => r.familyId));
      expect(families.size).toBe(2);
    });
  });

  describe('refresh', () => {
    it('rotates a valid refresh token and issues a new pair', async () => {
      const service = buildService(store);
      const roles = async () => ['CUSTOMER'];
      const first = await service.issueSession(USER_ID, 'customer', ['CUSTOMER']);

      const result = await service.refresh(first.refreshToken, roles);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.tokens.refreshToken).not.toBe(first.refreshToken);
      expect(result.userId).toBe(USER_ID);
      expect(result.audience).toBe('customer');
    });

    it('revokes the old token once it has been rotated', async () => {
      const service = buildService(store);
      const roles = async () => ['CUSTOMER'];
      const first = await service.issueSession(USER_ID, 'customer', ['CUSTOMER']);
      await service.refresh(first.refreshToken, roles);

      const oldRecord = store.records.find(
        (r) => r.tokenHash === hashRefreshToken(first.refreshToken)
      );
      expect(oldRecord?.revokedAt).not.toBeNull();
    });

    it('keeps the new token in the same family as the one it replaced', async () => {
      const service = buildService(store);
      const roles = async () => ['CUSTOMER'];
      const first = await service.issueSession(USER_ID, 'customer', ['CUSTOMER']);
      const result = await service.refresh(first.refreshToken, roles);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const oldRecord = store.records.find(
        (r) => r.tokenHash === hashRefreshToken(first.refreshToken)
      );
      const newRecord = store.records.find(
        (r) => r.tokenHash === hashRefreshToken(result.tokens.refreshToken)
      );
      expect(newRecord?.familyId).toBe(oldRecord?.familyId);
    });

    it('detects reuse when an already-rotated token is presented again, and revokes the whole family', async () => {
      const service = buildService(store);
      const roles = async () => ['CUSTOMER'];
      const first = await service.issueSession(USER_ID, 'customer', ['CUSTOMER']);
      const second = await service.refresh(first.refreshToken, roles);
      expect(second.ok).toBe(true);
      if (!second.ok) return;

      // The stolen, already-superseded token is presented again.
      const replay = await service.refresh(first.refreshToken, roles);
      expect(replay).toEqual({ ok: false, reason: 'REUSE_DETECTED' });

      // The legitimate, correctly-rotated token is also dead now: the whole
      // family was burned, which is the point - the attacker forced this.
      const legitimateAttempt = await service.refresh(second.tokens.refreshToken, roles);
      expect(legitimateAttempt.ok).toBe(false);
    });

    it('rejects an expired refresh token', async () => {
      let clock = new Date('2026-01-01T00:00:00Z');
      const service = buildService(store, { now: () => clock });
      const roles = async () => ['CUSTOMER'];
      const first = await service.issueSession(USER_ID, 'customer', ['CUSTOMER']);

      clock = new Date(clock.getTime() + 31 * 24 * 60 * 60 * 1000);
      const result = await service.refresh(first.refreshToken, roles);
      expect(result).toEqual({ ok: false, reason: 'EXPIRED' });
    });

    it('rejects a token that was never issued', async () => {
      const service = buildService(store);
      const roles = async () => ['CUSTOMER'];
      const result = await service.refresh('not-a-real-token', roles);
      expect(result).toEqual({ ok: false, reason: 'INVALID' });
    });

    it('picks up a changed role set on rotation rather than reusing stale claims', async () => {
      const service = buildService(store);
      const first = await service.issueSession(USER_ID, 'customer', ['CUSTOMER']);

      const result = await service.refresh(first.refreshToken, async () => [
        'CUSTOMER',
        'MERCHANT_OWNER',
      ]);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const verified = await service.verifyAccessToken(result.tokens.accessToken, 'customer');
      expect(verified.ok).toBe(true);
      if (verified.ok) expect(verified.claims.roles).toEqual(['CUSTOMER', 'MERCHANT_OWNER']);
    });
  });

  describe('revokeSession', () => {
    it('ends the session so the refresh token can no longer be used', async () => {
      const service = buildService(store);
      const roles = async () => ['CUSTOMER'];
      const tokens = await service.issueSession(USER_ID, 'customer', ['CUSTOMER']);

      await service.revokeSession(tokens.refreshToken);

      const result = await service.refresh(tokens.refreshToken, roles);
      expect(result.ok).toBe(false);
    });

    it('does nothing harmful when the token is already unknown', async () => {
      const service = buildService(store);
      await expect(service.revokeSession('never-issued')).resolves.toBeUndefined();
    });
  });
});
