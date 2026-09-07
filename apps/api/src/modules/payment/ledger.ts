/**
 * Double-entry ledger posting. Every write here goes through Prisma's
 * `$transaction`, which is what lets the deferred sum-to-zero constraint
 * trigger from the payments migration actually do its job: DEFERRABLE
 * INITIALLY DEFERRED fires at commit, so it only ever sees a fully-written
 * set of entries, not one row at a time. If application logic ever tries to
 * post an unbalanced transaction, the database rejects it - this file is
 * not the last line of defense, the constraint is.
 *
 * `LedgerTxn.reference` is unique and doubles as an idempotency key: two
 * calls with the same reference post the transaction once. A duplicate is
 * not an error, since the caller (a payment webhook, in particular) may
 * legitimately be retried or delivered twice.
 */

import { Prisma } from '../../generated/prisma/index.js';
import { getDb } from '../../platform/db.js';
import { calculateCommission } from './commission.js';

export type LedgerOwnerType = 'PLATFORM' | 'MERCHANT' | 'DRIVER' | 'CUSTOMER';
export type LedgerAccountKind = 'REVENUE' | 'PAYABLE' | 'COMMISSION' | 'WALLET' | 'ESCROW';
export type LedgerDirection = 'DEBIT' | 'CREDIT';

/** There is one platform, so its accounts all share this fixed owner id. */
export const PLATFORM_OWNER_ID = 'platform';

export async function getOrCreateAccount(params: {
  ownerType: LedgerOwnerType;
  ownerId: string;
  kind: LedgerAccountKind;
  currency: string;
}): Promise<string> {
  const db = getDb();
  const existing = await db.ledgerAccount.findUnique({
    where: {
      ownerType_ownerId_kind_currency: {
        ownerType: params.ownerType,
        ownerId: params.ownerId,
        kind: params.kind,
        currency: params.currency,
      },
    },
    select: { id: true },
  });
  if (existing) return existing.id;

  const created = await db.ledgerAccount.create({
    data: params,
    select: { id: true },
  });
  return created.id;
}

export interface LedgerEntryInput {
  accountId: string;
  direction: LedgerDirection;
  amountMinor: bigint;
}

export type PostTransactionResult =
  { posted: true; txnId: string } | { posted: false; reason: 'ALREADY_POSTED' };

export async function postLedgerTransaction(params: {
  reference: string;
  kind: string;
  currency: string;
  entries: LedgerEntryInput[];
  memo?: string;
}): Promise<PostTransactionResult> {
  const db = getDb();
  try {
    const txnId = await db.$transaction(async (tx) => {
      const txn = await tx.ledgerTxn.create({
        data: {
          reference: params.reference,
          kind: params.kind,
          ...(params.memo !== undefined ? { memo: params.memo } : {}),
        },
      });

      await tx.ledgerEntry.createMany({
        data: params.entries.map((entry) => ({
          txnId: txn.id,
          accountId: entry.accountId,
          direction: entry.direction,
          amountMinor: entry.amountMinor,
          currency: params.currency,
        })),
      });

      return txn.id;
    });

    return { posted: true, txnId };
  } catch (err) {
    // P2002: unique constraint violation, on LedgerTxn.reference. This
    // reference was already posted - a retried webhook, most likely - so
    // reporting it as already-done is correct, not a failure to surface.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return { posted: false, reason: 'ALREADY_POSTED' };
    }
    throw err;
  }
}

/**
 * Posts both ledger transactions for one successful order payment: the
 * funds received (held in platform escrow, owed to the merchant), and the
 * platform's commission out of what is owed. Two transactions rather than
 * one four-entry transaction, so each is independently idempotent under its
 * own reference and the commission split is visible in the ledger as its
 * own event, not folded into the payment receipt.
 */
export async function postOrderPaymentLedger(params: {
  orderId: string;
  merchantId: string;
  amountMinor: bigint;
  currency: string;
  commissionRateBps: number;
}): Promise<{ paymentPosted: boolean; commissionPosted: boolean; commissionMinor: bigint }> {
  const platformEscrow = await getOrCreateAccount({
    ownerType: 'PLATFORM',
    ownerId: PLATFORM_OWNER_ID,
    kind: 'ESCROW',
    currency: params.currency,
  });
  const merchantPayable = await getOrCreateAccount({
    ownerType: 'MERCHANT',
    ownerId: params.merchantId,
    kind: 'PAYABLE',
    currency: params.currency,
  });

  const paymentResult = await postLedgerTransaction({
    reference: `order-payment:${params.orderId}`,
    kind: 'ORDER_PAYMENT',
    currency: params.currency,
    memo: `Payment received for order ${params.orderId}`,
    entries: [
      { accountId: platformEscrow, direction: 'DEBIT', amountMinor: params.amountMinor },
      { accountId: merchantPayable, direction: 'CREDIT', amountMinor: params.amountMinor },
    ],
  });

  const commissionMinor = calculateCommission(params.amountMinor, params.commissionRateBps);

  // A zero commission still resolves with commissionPosted: true - there is
  // simply nothing to post, which is a successful outcome, not a skipped one.
  if (commissionMinor === 0n) {
    return { paymentPosted: paymentResult.posted, commissionPosted: true, commissionMinor };
  }

  const platformRevenue = await getOrCreateAccount({
    ownerType: 'PLATFORM',
    ownerId: PLATFORM_OWNER_ID,
    kind: 'REVENUE',
    currency: params.currency,
  });

  const commissionResult = await postLedgerTransaction({
    reference: `order-commission:${params.orderId}`,
    kind: 'ORDER_COMMISSION',
    currency: params.currency,
    memo: `Commission on order ${params.orderId}`,
    entries: [
      { accountId: merchantPayable, direction: 'DEBIT', amountMinor: commissionMinor },
      { accountId: platformRevenue, direction: 'CREDIT', amountMinor: commissionMinor },
    ],
  });

  return {
    paymentPosted: paymentResult.posted,
    commissionPosted: commissionResult.posted,
    commissionMinor,
  };
}
