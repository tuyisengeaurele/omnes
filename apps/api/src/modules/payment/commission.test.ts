import { describe, expect, it } from 'vitest';
import { calculateCommission, splitCommission } from './commission.js';

describe('calculateCommission', () => {
  it('computes a straightforward percentage', () => {
    // 15% of 10000
    expect(calculateCommission(10000n, 1500)).toBe(1500n);
  });

  it('is zero for a zero rate', () => {
    expect(calculateCommission(10000n, 0)).toBe(0n);
  });

  it('is zero for a zero amount', () => {
    expect(calculateCommission(0n, 1500)).toBe(0n);
  });

  it('rounds a result landing exactly on a half unit up', () => {
    // 1 * 50% = 0.5, rounds up to 1
    expect(calculateCommission(1n, 5000)).toBe(1n);
  });

  it('rounds a result just below a half unit down', () => {
    // 1 * 40% = 0.4, rounds down to 0
    expect(calculateCommission(1n, 4000)).toBe(0n);
  });

  it('rounds a three-quarter result up', () => {
    // 3 * 25% = 0.75, rounds up to 1
    expect(calculateCommission(3n, 2500)).toBe(1n);
  });

  it('handles a 100% rate', () => {
    expect(calculateCommission(5000n, 10000)).toBe(5000n);
  });

  it('handles a large amount without losing precision', () => {
    expect(calculateCommission(999_999_999_000n, 1500)).toBe(149_999_999_850n);
  });

  it('rejects a negative amount', () => {
    expect(() => calculateCommission(-1n, 1500)).toThrow(RangeError);
  });

  it('rejects a negative rate', () => {
    expect(() => calculateCommission(1000n, -1)).toThrow(RangeError);
  });

  it('rejects a non-integer rate', () => {
    expect(() => calculateCommission(1000n, 15.5)).toThrow(RangeError);
  });
});

describe('splitCommission', () => {
  it('splits an amount into commission and net, summing back to gross', () => {
    const result = splitCommission(10000n, 1500);
    expect(result.grossMinor).toBe(10000n);
    expect(result.commissionMinor).toBe(1500n);
    expect(result.netMinor).toBe(8500n);
    expect(result.commissionMinor + result.netMinor).toBe(result.grossMinor);
  });

  it('gives the merchant everything when the rate is zero', () => {
    const result = splitCommission(10000n, 0);
    expect(result.commissionMinor).toBe(0n);
    expect(result.netMinor).toBe(10000n);
  });

  it('gives the platform everything when the rate is 100%', () => {
    const result = splitCommission(10000n, 10000);
    expect(result.commissionMinor).toBe(10000n);
    expect(result.netMinor).toBe(0n);
  });
});
