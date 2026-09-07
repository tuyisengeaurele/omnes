/**
 * Commission calculation. A pure function, same discipline as the pricing
 * engine in the order module: no I/O, BigInt only, no floating-point money.
 * This is what decides how much of an order total the platform keeps and
 * how much is owed to the merchant, so it gets the same heavy unit test
 * coverage the build plan calls for on anything money-touching.
 */

/**
 * Round-half-up in pure BigInt arithmetic, identical in spirit to the
 * service fee calculation in order/pricing.ts: (amount * bps + half the
 * divisor) / divisor, so the rounding term is added before the integer
 * division truncates.
 */
export function calculateCommission(amountMinor: bigint, rateBps: number): bigint {
  if (amountMinor < 0n) {
    throw new RangeError('amountMinor must not be negative');
  }
  if (!Number.isInteger(rateBps) || rateBps < 0) {
    throw new RangeError('rateBps must be a non-negative integer');
  }

  const bps = BigInt(rateBps);
  return (amountMinor * bps + 5000n) / 10000n;
}

export interface CommissionBreakdown {
  grossMinor: bigint;
  commissionMinor: bigint;
  netMinor: bigint;
}

/** What the platform keeps and what remains owed to the merchant, from one order total. */
export function splitCommission(amountMinor: bigint, rateBps: number): CommissionBreakdown {
  const commissionMinor = calculateCommission(amountMinor, rateBps);
  return {
    grossMinor: amountMinor,
    commissionMinor,
    netMinor: amountMinor - commissionMinor,
  };
}
