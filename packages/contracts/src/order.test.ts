import { describe, expect, it } from 'vitest';
import { orderActionReasonSchema } from './order.js';

describe('orderActionReasonSchema', () => {
  it('accepts an empty body, since reason is optional', () => {
    expect(orderActionReasonSchema.safeParse({}).success).toBe(true);
  });

  it('accepts a reason within the length limit', () => {
    expect(orderActionReasonSchema.safeParse({ reason: 'Out of stock' }).success).toBe(true);
  });

  it('rejects a blank reason', () => {
    expect(orderActionReasonSchema.safeParse({ reason: '   ' }).success).toBe(false);
  });

  it('rejects a reason over 500 characters', () => {
    expect(orderActionReasonSchema.safeParse({ reason: 'x'.repeat(501) }).success).toBe(false);
  });
});
