import { beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  createOtpService,
  hashOtpCode,
  type OtpChallengeRecord,
  type OtpPurpose,
  type OtpStore,
} from './otp.service.js';

/**
 * In-memory OtpStore. Deliberately reimplements the same selection rules a
 * real Prisma-backed store would (latest-by-createdAt, filtered by phone and
 * purpose) so the tests exercise the actual contract the service depends on,
 * not a trivial stub that always returns the one record it was given.
 */
class FakeOtpStore implements OtpStore {
  records: OtpChallengeRecord[] = [];

  async create(input: {
    phoneE164: string;
    codeHash: string;
    purpose: OtpPurpose;
    expiresAt: Date;
  }): Promise<OtpChallengeRecord> {
    const record: OtpChallengeRecord = {
      id: randomUUID(),
      phoneE164: input.phoneE164,
      codeHash: input.codeHash,
      purpose: input.purpose,
      attempts: 0,
      expiresAt: input.expiresAt,
      consumedAt: null,
      createdAt: new Date(),
    };
    this.records.push(record);
    return record;
  }

  async findLatest(phoneE164: string, purpose: OtpPurpose): Promise<OtpChallengeRecord | null> {
    const matches = this.records
      .filter((r) => r.phoneE164 === phoneE164 && r.purpose === purpose)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return matches[0] ?? null;
  }

  async incrementAttempts(id: string): Promise<void> {
    const record = this.records.find((r) => r.id === id);
    if (record) record.attempts += 1;
  }

  async markConsumed(id: string, consumedAt: Date): Promise<void> {
    const record = this.records.find((r) => r.id === id);
    if (record) record.consumedAt = consumedAt;
  }

  async countSince(phoneE164: string, since: Date): Promise<number> {
    return this.records.filter((r) => r.phoneE164 === phoneE164 && r.createdAt >= since).length;
  }
}

const PHONE = '+250780000000';
const PEPPER = 'test-pepper-value-not-a-real-secret';

function buildService(store: FakeOtpStore, overrides: { now?: () => Date } = {}) {
  return createOtpService({
    store,
    pepper: PEPPER,
    ttlSeconds: 300,
    codeLength: 6,
    maxAttempts: 3,
    requestsPerHour: 5,
    ...overrides,
  });
}

describe('otp service', () => {
  let store: FakeOtpStore;

  beforeEach(() => {
    store = new FakeOtpStore();
  });

  describe('issue', () => {
    it('generates a code of the configured length', async () => {
      const service = buildService(store);
      const outcome = await service.issue(PHONE, 'LOGIN');
      expect(outcome.ok).toBe(true);
      if (outcome.ok) expect(outcome.result.code).toMatch(/^\d{6}$/);
    });

    it('never stores the plaintext code, only its hash', async () => {
      const service = buildService(store);
      const outcome = await service.issue(PHONE, 'LOGIN');
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      const stored = store.records[0];
      expect(stored?.codeHash).not.toBe(outcome.result.code);
      expect(stored?.codeHash).toBe(hashOtpCode(outcome.result.code, PEPPER));
    });

    it('rate-limits after the configured number of requests in the last hour', async () => {
      const service = buildService(store);
      for (let i = 0; i < 5; i++) {
        const outcome = await service.issue(PHONE, 'LOGIN');
        expect(outcome.ok).toBe(true);
      }
      const sixth = await service.issue(PHONE, 'LOGIN');
      expect(sixth.ok).toBe(false);
      if (!sixth.ok) {
        expect(sixth.reason).toBe('RATE_LIMITED');
        expect(sixth.retryAfterSeconds).toBeGreaterThan(0);
      }
    });

    it('does not rate-limit a different phone number', async () => {
      const service = buildService(store);
      for (let i = 0; i < 5; i++) await service.issue(PHONE, 'LOGIN');
      const other = await service.issue('+250780000001', 'LOGIN');
      expect(other.ok).toBe(true);
    });

    it('counts requests across purposes toward the same phone limit', async () => {
      const service = buildService(store);
      for (let i = 0; i < 3; i++) await service.issue(PHONE, 'LOGIN');
      for (let i = 0; i < 2; i++) await service.issue(PHONE, 'REGISTER');
      const sixth = await service.issue(PHONE, 'ACCOUNT_RECOVERY');
      expect(sixth.ok).toBe(false);
    });
  });

  describe('verify', () => {
    it('succeeds with the correct code', async () => {
      const service = buildService(store);
      const issued = await service.issue(PHONE, 'LOGIN');
      expect(issued.ok).toBe(true);
      if (!issued.ok) return;
      const result = await service.verify(PHONE, 'LOGIN', issued.result.code);
      expect(result.ok).toBe(true);
    });

    it('rejects an incorrect code without consuming the challenge', async () => {
      const service = buildService(store);
      await service.issue(PHONE, 'LOGIN');
      const result = await service.verify(PHONE, 'LOGIN', '000000');
      expect(result).toEqual({ ok: false, reason: 'INCORRECT_CODE' });
    });

    it('rejects verification when no challenge was ever issued', async () => {
      const service = buildService(store);
      const result = await service.verify(PHONE, 'LOGIN', '123456');
      expect(result).toEqual({ ok: false, reason: 'NOT_FOUND' });
    });

    it('rejects an expired code', async () => {
      let clock = new Date('2026-01-01T00:00:00Z');
      const service = buildService(store, { now: () => clock });
      const issued = await service.issue(PHONE, 'LOGIN');
      expect(issued.ok).toBe(true);
      if (!issued.ok) return;

      clock = new Date(clock.getTime() + 301 * 1000); // past the 300s ttl
      const result = await service.verify(PHONE, 'LOGIN', issued.result.code);
      expect(result).toEqual({ ok: false, reason: 'EXPIRED' });
    });

    it('accepts a code right up to the ttl boundary', async () => {
      let clock = new Date('2026-01-01T00:00:00Z');
      const service = buildService(store, { now: () => clock });
      const issued = await service.issue(PHONE, 'LOGIN');
      expect(issued.ok).toBe(true);
      if (!issued.ok) return;

      clock = new Date(clock.getTime() + 300 * 1000); // exactly at the ttl
      const result = await service.verify(PHONE, 'LOGIN', issued.result.code);
      expect(result.ok).toBe(true);
    });

    it('rejects a replayed code after it has already been consumed', async () => {
      const service = buildService(store);
      const issued = await service.issue(PHONE, 'LOGIN');
      expect(issued.ok).toBe(true);
      if (!issued.ok) return;

      const first = await service.verify(PHONE, 'LOGIN', issued.result.code);
      expect(first.ok).toBe(true);

      const replay = await service.verify(PHONE, 'LOGIN', issued.result.code);
      expect(replay).toEqual({ ok: false, reason: 'ALREADY_CONSUMED' });
    });

    it('locks out after the configured number of incorrect attempts', async () => {
      const service = buildService(store);
      const issued = await service.issue(PHONE, 'LOGIN');
      expect(issued.ok).toBe(true);
      if (!issued.ok) return;

      await service.verify(PHONE, 'LOGIN', '000000');
      await service.verify(PHONE, 'LOGIN', '111111');
      await service.verify(PHONE, 'LOGIN', '222222');

      // Even the correct code is now refused: the budget is spent, not the guess.
      const result = await service.verify(PHONE, 'LOGIN', issued.result.code);
      expect(result).toEqual({ ok: false, reason: 'MAX_ATTEMPTS_EXCEEDED' });
    });

    it('does not let a REGISTER code verify a LOGIN attempt', async () => {
      const service = buildService(store);
      const issued = await service.issue(PHONE, 'REGISTER');
      expect(issued.ok).toBe(true);
      if (!issued.ok) return;

      const result = await service.verify(PHONE, 'LOGIN', issued.result.code);
      expect(result).toEqual({ ok: false, reason: 'NOT_FOUND' });
    });

    it('only checks the most recent challenge when several were issued', async () => {
      const service = buildService(store);
      const first = await service.issue(PHONE, 'LOGIN');
      // Ensure createdAt actually differs between the two records.
      await new Promise((r) => setTimeout(r, 5));
      const second = await service.issue(PHONE, 'LOGIN');
      expect(first.ok && second.ok).toBe(true);
      if (!first.ok || !second.ok) return;

      const oldCodeResult = await service.verify(PHONE, 'LOGIN', first.result.code);
      expect(oldCodeResult.ok).toBe(false);

      const newCodeResult = await service.verify(PHONE, 'LOGIN', second.result.code);
      expect(newCodeResult.ok).toBe(true);
    });
  });
});
