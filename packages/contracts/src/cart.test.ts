import { describe, expect, it } from 'vitest';
import { addCartItemSchema, updateCartItemQuantitySchema } from './cart.js';

const PRODUCT_ID = '950a5a76-6872-4e8b-8e6d-7d9eaddb6cbc';

describe('addCartItemSchema', () => {
  it('accepts a valid payload', () => {
    expect(addCartItemSchema.safeParse({ productId: PRODUCT_ID, quantity: 2 }).success).toBe(
      true
    );
  });

  it('rejects a quantity of zero', () => {
    expect(addCartItemSchema.safeParse({ productId: PRODUCT_ID, quantity: 0 }).success).toBe(
      false
    );
  });

  it('rejects a quantity above the cap', () => {
    expect(addCartItemSchema.safeParse({ productId: PRODUCT_ID, quantity: 100 }).success).toBe(
      false
    );
  });

  it('rejects a non-uuid productId', () => {
    expect(addCartItemSchema.safeParse({ productId: 'not-a-uuid', quantity: 1 }).success).toBe(
      false
    );
  });

  it('accepts an optional note', () => {
    const result = addCartItemSchema.safeParse({
      productId: PRODUCT_ID,
      quantity: 1,
      notes: 'no onions',
    });
    expect(result.success).toBe(true);
  });
});

describe('updateCartItemQuantitySchema', () => {
  it('accepts a valid quantity', () => {
    expect(updateCartItemQuantitySchema.safeParse({ quantity: 5 }).success).toBe(true);
  });

  it('rejects a quantity of zero, since removal is a separate endpoint', () => {
    expect(updateCartItemQuantitySchema.safeParse({ quantity: 0 }).success).toBe(false);
  });
});
