/**
 * Ledger tests against the real database (omnes_test) - the constraint
 * being verified here is a Postgres deferred trigger, not application code,
 * so a fake store would not actually prove anything about it.
 */

import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { getDb, disconnectDb } from '../../platform/db.js';
import {
  getOrCreateAccount,
  postLedgerTransaction,
  postOrderPaymentLedger,
  PLATFORM_OWNER_ID,
} from './ledger.js';

const CURRENCY = 'RWF';
const createdAccountIds: string[] = [];

async function trackedAccount(ownerType: 'PLATFORM' | 'MERCHANT', ownerId: string, kind: string) {
  const id = await getOrCreateAccount({
    ownerType,
    ownerId,
    kind: kind as never,
    currency: CURRENCY,
  });
  createdAccountIds.push(id);
  return id;
}

async function accountBalance(accountId: string): Promise<bigint> {
  const entries = await getDb().ledgerEntry.findMany({ where: { accountId } });
  return entries.reduce(
    (sum, e) => sum + (e.direction === 'CREDIT' ? e.amountMinor : -e.amountMinor),
    0n
  );
}

describe('ledger', () => {
  afterAll(async () => {
    const db = getDb();
    const entries = await db.ledgerEntry.findMany({
      where: { accountId: { in: createdAccountIds } },
    });
    const txnIds = [...new Set(entries.map((e) => e.txnId))];
    await db.ledgerEntry.deleteMany({ where: { accountId: { in: createdAccountIds } } });
    if (txnIds.length > 0) await db.ledgerTxn.deleteMany({ where: { id: { in: txnIds } } });
    await db.ledgerAccount.deleteMany({ where: { id: { in: createdAccountIds } } });
    await disconnectDb();
  });

  describe('getOrCreateAccount', () => {
    it('returns the same account id on repeated calls', async () => {
      const ownerId = randomUUID();
      const first = await trackedAccount('MERCHANT', ownerId, 'PAYABLE');
      const second = await getOrCreateAccount({
        ownerType: 'MERCHANT',
        ownerId,
        kind: 'PAYABLE',
        currency: CURRENCY,
      });
      expect(second).toBe(first);
    });
  });

  describe('postLedgerTransaction', () => {
    it('posts a balanced transaction', async () => {
      const a = await trackedAccount('PLATFORM', PLATFORM_OWNER_ID, 'ESCROW');
      const b = await trackedAccount('MERCHANT', randomUUID(), 'PAYABLE');
      // `a` is the shared platform escrow account, reused across every test
      // in this file (and every other file that posts a real payment), so
      // only its delta is provable here - see the idempotency test below,
      // which documents the same thing.
      const balanceBefore = await accountBalance(a);

      const result = await postLedgerTransaction({
        reference: `test:${randomUUID()}`,
        kind: 'TEST',
        currency: CURRENCY,
        entries: [
          { accountId: a, direction: 'DEBIT', amountMinor: 1000n },
          { accountId: b, direction: 'CREDIT', amountMinor: 1000n },
        ],
      });

      expect(result.posted).toBe(true);
      expect(await accountBalance(a)).toBe(balanceBefore - 1000n);
      expect(await accountBalance(b)).toBe(1000n);
    });

    it('is idempotent under the same reference: the second call is a no-op', async () => {
      const a = await trackedAccount('PLATFORM', PLATFORM_OWNER_ID, 'ESCROW');
      const b = await trackedAccount('MERCHANT', randomUUID(), 'PAYABLE');
      const reference = `test:${randomUUID()}`;
      // `a` is the shared platform escrow account, reused across every test
      // in this file - its balance accumulates, so what this test can
      // actually prove is the *delta* the retry caused, not an absolute
      // value. `b` is a fresh account created just for this test and does
      // start at zero, so it can be asserted directly.
      const balanceBefore = await accountBalance(a);

      const first = await postLedgerTransaction({
        reference,
        kind: 'TEST',
        currency: CURRENCY,
        entries: [
          { accountId: a, direction: 'DEBIT', amountMinor: 500n },
          { accountId: b, direction: 'CREDIT', amountMinor: 500n },
        ],
      });
      const second = await postLedgerTransaction({
        reference,
        kind: 'TEST',
        currency: CURRENCY,
        entries: [
          { accountId: a, direction: 'DEBIT', amountMinor: 500n },
          { accountId: b, direction: 'CREDIT', amountMinor: 500n },
        ],
      });

      expect(first.posted).toBe(true);
      expect(second).toEqual({ posted: false, reason: 'ALREADY_POSTED' });
      // The retry did not double the effect: exactly one 500 debit landed.
      expect(await accountBalance(a)).toBe(balanceBefore - 500n);
      expect(await accountBalance(b)).toBe(500n);
    });

    it('rejects an unbalanced transaction at the database level', async () => {
      const a = await trackedAccount('PLATFORM', PLATFORM_OWNER_ID, 'ESCROW');
      const b = await trackedAccount('MERCHANT', randomUUID(), 'PAYABLE');

      await expect(
        postLedgerTransaction({
          reference: `test:${randomUUID()}`,
          kind: 'TEST',
          currency: CURRENCY,
          entries: [
            { accountId: a, direction: 'DEBIT', amountMinor: 1000n },
            { accountId: b, direction: 'CREDIT', amountMinor: 900n },
          ],
        })
      ).rejects.toThrow();
    });
  });

  describe('postOrderPaymentLedger', () => {
    it('posts payment and commission, netting the merchant payable to the post-commission amount', async () => {
      const orderId = randomUUID();
      const merchantId = randomUUID();

      // escrow and revenue are shared platform accounts (there is only one
      // platform) and accumulate across every test in this file, so their
      // effect is asserted as a delta; payable belongs to a merchantId
      // unique to this test and genuinely does start at zero.
      const escrow = await trackedAccount('PLATFORM', PLATFORM_OWNER_ID, 'ESCROW');
      const revenue = await trackedAccount('PLATFORM', PLATFORM_OWNER_ID, 'REVENUE');
      const escrowBefore = await accountBalance(escrow);
      const revenueBefore = await accountBalance(revenue);

      const result = await postOrderPaymentLedger({
        orderId,
        merchantId,
        amountMinor: 10_000n,
        currency: CURRENCY,
        commissionRateBps: 1500, // 15%
      });

      expect(result.paymentPosted).toBe(true);
      expect(result.commissionPosted).toBe(true);
      expect(result.commissionMinor).toBe(1500n);

      const payable = await trackedAccount('MERCHANT', merchantId, 'PAYABLE');

      expect(await accountBalance(escrow)).toBe(escrowBefore - 10_000n);
      // Merchant is owed the full 10000, minus 1500 commission = 8500.
      expect(await accountBalance(payable)).toBe(8500n);
      expect(await accountBalance(revenue)).toBe(revenueBefore + 1500n);
    });

    it('posts no commission transaction when the rate is zero, but still reports success', async () => {
      const orderId = randomUUID();
      const merchantId = randomUUID();

      const result = await postOrderPaymentLedger({
        orderId,
        merchantId,
        amountMinor: 5000n,
        currency: CURRENCY,
        commissionRateBps: 0,
      });

      expect(result.commissionMinor).toBe(0n);
      expect(result.commissionPosted).toBe(true);

      const payable = await trackedAccount('MERCHANT', merchantId, 'PAYABLE');
      expect(await accountBalance(payable)).toBe(5000n);
    });

    it('is idempotent when called twice for the same order', async () => {
      const orderId = randomUUID();
      const merchantId = randomUUID();

      await postOrderPaymentLedger({
        orderId,
        merchantId,
        amountMinor: 2000n,
        currency: CURRENCY,
        commissionRateBps: 1000,
      });
      const second = await postOrderPaymentLedger({
        orderId,
        merchantId,
        amountMinor: 2000n,
        currency: CURRENCY,
        commissionRateBps: 1000,
      });

      expect(second.paymentPosted).toBe(false);
      expect(second.commissionPosted).toBe(false);

      const payable = await trackedAccount('MERCHANT', merchantId, 'PAYABLE');
      // 2000 - 200 commission = 1800, posted once, not twice.
      expect(await accountBalance(payable)).toBe(1800n);
    });
  });
});
