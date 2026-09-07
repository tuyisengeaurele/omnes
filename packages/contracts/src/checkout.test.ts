import { describe, expect, it } from 'vitest';
import { checkoutSchema, paymentWebhookSchema } from './checkout.js';

const IDEMPOTENCY_KEY = '950a5a76-6872-4e8b-8e6d-7d9eaddb6cbc';

function validCheckout(overrides: Record<string, unknown> = {}) {
  return {
    address: { label: 'Home', latitude: -1.9441, longitude: 30.0619 },
    paymentMethod: 'MTN_MOMO',
    payerPhone: '+250780000000',
    idempotencyKey: IDEMPOTENCY_KEY,
    ...overrides,
  };
}

describe('checkoutSchema', () => {
  it('accepts a valid payload', () => {
    expect(checkoutSchema.safeParse(validCheckout()).success).toBe(true);
  });

  it('rejects an unsupported payment method', () => {
    expect(checkoutSchema.safeParse(validCheckout({ paymentMethod: 'CASH' })).success).toBe(false);
  });

  it('rejects a missing idempotencyKey', () => {
    const payload = validCheckout();
    delete (payload as Record<string, unknown>).idempotencyKey;
    expect(checkoutSchema.safeParse(payload).success).toBe(false);
  });

  it('rejects an idempotencyKey that is not a uuid', () => {
    expect(checkoutSchema.safeParse(validCheckout({ idempotencyKey: 'not-a-uuid' })).success).toBe(
      false
    );
  });

  it('rejects an address with an out-of-range latitude', () => {
    const payload = validCheckout({
      address: { label: 'Home', latitude: 200, longitude: 30.0619 },
    });
    expect(checkoutSchema.safeParse(payload).success).toBe(false);
  });

  it('accepts an optional landmark', () => {
    const payload = validCheckout({
      address: { label: 'Home', latitude: -1.9441, longitude: 30.0619, landmark: 'Blue gate' },
    });
    expect(checkoutSchema.safeParse(payload).success).toBe(true);
  });
});

describe('paymentWebhookSchema', () => {
  it('accepts a success payload', () => {
    expect(
      paymentWebhookSchema.safeParse({ providerRef: 'ref-1', status: 'SUCCEEDED' }).success
    ).toBe(true);
  });

  it('accepts a failure payload with error details', () => {
    const result = paymentWebhookSchema.safeParse({
      providerRef: 'ref-1',
      status: 'FAILED',
      errorCode: 'INSUFFICIENT_FUNDS',
      errorMessage: 'no balance',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an unrecognized status', () => {
    expect(paymentWebhookSchema.safeParse({ providerRef: 'ref-1', status: 'MAYBE' }).success).toBe(
      false
    );
  });

  it('rejects a missing providerRef', () => {
    expect(paymentWebhookSchema.safeParse({ status: 'SUCCEEDED' }).success).toBe(false);
  });
});
