import { describe, expect, it } from 'vitest';
import { priceCart, type FeeScheduleInput, type PricingLineItem } from './pricing.js';

const RWF_FEES: FeeScheduleInput = {
  baseFeeMinor: 500n,
  perKmFeeMinor: 200n,
  serviceFeeBps: 500, // 5%
};

function items(...lines: Array<[bigint, number]>): PricingLineItem[] {
  return lines.map(([unitPriceMinor, quantity]) => ({ unitPriceMinor, quantity }));
}

describe('priceCart: subtotal', () => {
  it('sums a single line item', () => {
    const result = priceCart({
      items: items([1000n, 2]),
      currency: 'RWF',
      feeSchedule: RWF_FEES,
    });
    expect(result.subtotalMinor).toBe(2000n);
  });

  it('sums multiple line items', () => {
    const result = priceCart({
      items: items([1000n, 2], [500n, 3], [250n, 1]),
      currency: 'RWF',
      feeSchedule: RWF_FEES,
    });
    // 2000 + 1500 + 250
    expect(result.subtotalMinor).toBe(3750n);
  });

  it('is zero for an empty cart', () => {
    const result = priceCart({ items: [], currency: 'RWF', feeSchedule: RWF_FEES });
    expect(result.subtotalMinor).toBe(0n);
  });

  it('handles a large quantity and price without losing precision', () => {
    const result = priceCart({
      items: items([999_999_999n, 1000]),
      currency: 'RWF',
      feeSchedule: RWF_FEES,
    });
    expect(result.subtotalMinor).toBe(999_999_999_000n);
  });
});

describe('priceCart: delivery fee', () => {
  it('charges only the base fee when no distance is given', () => {
    const result = priceCart({ items: items([1000n, 1]), currency: 'RWF', feeSchedule: RWF_FEES });
    expect(result.deliveryFeeMinor).toBe(500n);
  });

  it('charges only the base fee for zero distance', () => {
    const result = priceCart({
      items: items([1000n, 1]),
      currency: 'RWF',
      feeSchedule: RWF_FEES,
      distanceKm: 0,
    });
    expect(result.deliveryFeeMinor).toBe(500n);
  });

  it('charges only the base fee for a negative distance', () => {
    const result = priceCart({
      items: items([1000n, 1]),
      currency: 'RWF',
      feeSchedule: RWF_FEES,
      distanceKm: -3,
    });
    expect(result.deliveryFeeMinor).toBe(500n);
  });

  it('adds the per-km component for a whole-number distance', () => {
    const result = priceCart({
      items: items([1000n, 1]),
      currency: 'RWF',
      feeSchedule: RWF_FEES,
      distanceKm: 5,
    });
    // 500 base + 5 * 200
    expect(result.deliveryFeeMinor).toBe(1500n);
  });

  it('rounds a fractional distance to the nearest minor unit', () => {
    const result = priceCart({
      items: items([1000n, 1]),
      currency: 'RWF',
      feeSchedule: RWF_FEES,
      distanceKm: 3.333,
    });
    // 500 base + round(3.333 * 200) = 500 + round(666.6) = 500 + 667
    expect(result.deliveryFeeMinor).toBe(1167n);
  });

  it('rounds a distance landing exactly on a half unit up', () => {
    const result = priceCart({
      items: items([1000n, 1]),
      currency: 'RWF',
      feeSchedule: { baseFeeMinor: 0n, perKmFeeMinor: 100n, serviceFeeBps: 0 },
      distanceKm: 2.505,
    });
    // 2.505 * 100 = 250.5 -> rounds up to 251
    expect(result.deliveryFeeMinor).toBe(251n);
  });
});

describe('priceCart: service fee', () => {
  it('applies a straightforward percentage', () => {
    const result = priceCart({
      items: items([10000n, 1]),
      currency: 'RWF',
      feeSchedule: { baseFeeMinor: 0n, perKmFeeMinor: 0n, serviceFeeBps: 500 },
    });
    // 5% of 10000
    expect(result.serviceFeeMinor).toBe(500n);
  });

  it('is zero when serviceFeeBps is zero', () => {
    const result = priceCart({
      items: items([10000n, 1]),
      currency: 'RWF',
      feeSchedule: { baseFeeMinor: 0n, perKmFeeMinor: 0n, serviceFeeBps: 0 },
    });
    expect(result.serviceFeeMinor).toBe(0n);
  });

  it('rounds a result landing exactly on a half unit up', () => {
    const result = priceCart({
      items: items([1n, 1]),
      currency: 'RWF',
      feeSchedule: { baseFeeMinor: 0n, perKmFeeMinor: 0n, serviceFeeBps: 5000 },
    });
    // 1 * 50% = 0.5, rounds up to 1
    expect(result.serviceFeeMinor).toBe(1n);
  });

  it('rounds a result just below a half unit down', () => {
    const result = priceCart({
      items: items([1n, 1]),
      currency: 'RWF',
      feeSchedule: { baseFeeMinor: 0n, perKmFeeMinor: 0n, serviceFeeBps: 4000 },
    });
    // 1 * 40% = 0.4, rounds down to 0
    expect(result.serviceFeeMinor).toBe(0n);
  });

  it('rounds a three-quarter result up', () => {
    const result = priceCart({
      items: items([3n, 1]),
      currency: 'RWF',
      feeSchedule: { baseFeeMinor: 0n, perKmFeeMinor: 0n, serviceFeeBps: 2500 },
    });
    // 3 * 25% = 0.75, rounds up to 1
    expect(result.serviceFeeMinor).toBe(1n);
  });
});

describe('priceCart: discount', () => {
  it('subtracts a discount within range', () => {
    const result = priceCart({
      items: items([1000n, 1]),
      currency: 'RWF',
      feeSchedule: { baseFeeMinor: 0n, perKmFeeMinor: 0n, serviceFeeBps: 0 },
      discountMinor: 200n,
    });
    expect(result.discountMinor).toBe(200n);
    expect(result.totalMinor).toBe(800n);
  });

  it('clamps a discount larger than the total so total never goes negative', () => {
    const result = priceCart({
      items: items([1000n, 1]),
      currency: 'RWF',
      feeSchedule: { baseFeeMinor: 0n, perKmFeeMinor: 0n, serviceFeeBps: 0 },
      discountMinor: 5000n,
    });
    expect(result.discountMinor).toBe(1000n);
    expect(result.totalMinor).toBe(0n);
  });

  it('ignores a negative discount rather than inflating the total', () => {
    const result = priceCart({
      items: items([1000n, 1]),
      currency: 'RWF',
      feeSchedule: { baseFeeMinor: 0n, perKmFeeMinor: 0n, serviceFeeBps: 0 },
      discountMinor: -500n,
    });
    expect(result.discountMinor).toBe(0n);
    expect(result.totalMinor).toBe(1000n);
  });

  it('defaults to no discount when omitted', () => {
    const result = priceCart({
      items: items([1000n, 1]),
      currency: 'RWF',
      feeSchedule: { baseFeeMinor: 0n, perKmFeeMinor: 0n, serviceFeeBps: 0 },
    });
    expect(result.discountMinor).toBe(0n);
  });
});

describe('priceCart: total and currency', () => {
  it('adds subtotal, delivery fee, and service fee, minus discount', () => {
    const result = priceCart({
      items: items([2000n, 2]), // subtotal 4000
      currency: 'RWF',
      feeSchedule: RWF_FEES, // base 500, 5% service
      distanceKm: 2, // +400 delivery -> 900 delivery total
      discountMinor: 100n,
    });
    expect(result.subtotalMinor).toBe(4000n);
    expect(result.deliveryFeeMinor).toBe(900n);
    expect(result.serviceFeeMinor).toBe(200n); // 5% of 4000
    expect(result.discountMinor).toBe(100n);
    expect(result.totalMinor).toBe(4000n + 900n + 200n - 100n);
  });

  it('passes the currency through unchanged', () => {
    const result = priceCart({ items: [], currency: 'USD', feeSchedule: RWF_FEES });
    expect(result.currency).toBe('USD');
  });
});
