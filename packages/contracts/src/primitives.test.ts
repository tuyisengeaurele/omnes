import { describe, expect, it } from 'vitest';
import {
  apiErrorSchema,
  coordinatesSchema,
  emailSchema,
  moneySchema,
  paginatedResponseSchema,
  paginationQuerySchema,
  phoneE164Schema,
} from './primitives.js';
import { z } from 'zod';

describe('phoneE164Schema', () => {
  it('accepts a Rwandan number with a leading plus', () => {
    expect(phoneE164Schema.safeParse('+250780000000').success).toBe(true);
  });

  it('accepts a diaspora number without a leading plus', () => {
    expect(phoneE164Schema.safeParse('447700900000').success).toBe(true);
  });

  it('rejects a number starting with a leading zero after the plus', () => {
    expect(phoneE164Schema.safeParse('+0780000000').success).toBe(false);
  });

  it('rejects letters', () => {
    expect(phoneE164Schema.safeParse('+250780abcdef').success).toBe(false);
  });

  it('rejects a number that is too short to be real', () => {
    expect(phoneE164Schema.safeParse('+2501').success).toBe(false);
  });
});

describe('emailSchema', () => {
  it('lowercases and trims a valid address', () => {
    const result = emailSchema.safeParse('  User@Example.com  ');
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe('user@example.com');
  });

  it('rejects a string with no @', () => {
    expect(emailSchema.safeParse('not-an-email').success).toBe(false);
  });
});

describe('moneySchema', () => {
  it('accepts an integer amount with a three letter currency', () => {
    const result = moneySchema.safeParse({ amountMinor: '150000', currency: 'rwf' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.currency).toBe('RWF');
  });

  it('accepts a negative amount, for reversing ledger entries', () => {
    expect(moneySchema.safeParse({ amountMinor: '-500', currency: 'RWF' }).success).toBe(true);
  });

  it('rejects a decimal amount', () => {
    expect(moneySchema.safeParse({ amountMinor: '150.50', currency: 'RWF' }).success).toBe(false);
  });

  it('rejects a currency code that is not three letters', () => {
    expect(moneySchema.safeParse({ amountMinor: '100', currency: 'RW' }).success).toBe(false);
  });
});

describe('coordinatesSchema', () => {
  it('accepts a real Kigali coordinate', () => {
    expect(coordinatesSchema.safeParse({ latitude: -1.9441, longitude: 30.0619 }).success).toBe(
      true
    );
  });

  it('rejects a latitude out of range', () => {
    expect(coordinatesSchema.safeParse({ latitude: 91, longitude: 0 }).success).toBe(false);
  });

  it('rejects a longitude out of range', () => {
    expect(coordinatesSchema.safeParse({ latitude: 0, longitude: -181 }).success).toBe(false);
  });
});

describe('paginationQuerySchema', () => {
  it('defaults limit to 20 when omitted', () => {
    const result = paginationQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.limit).toBe(20);
  });

  it('coerces a string query-param limit to a number', () => {
    const result = paginationQuerySchema.safeParse({ limit: '5' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.limit).toBe(5);
  });

  it('rejects a limit above the cap, so a client cannot request an unbounded page', () => {
    expect(paginationQuerySchema.safeParse({ limit: '5000' }).success).toBe(false);
  });

  it('rejects a limit of zero', () => {
    expect(paginationQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
  });
});

describe('paginatedResponseSchema', () => {
  it('validates a page of items against the wrapped schema', () => {
    const schema = paginatedResponseSchema(z.object({ name: z.string() }));
    const result = schema.safeParse({ items: [{ name: 'a' }], nextCursor: null });
    expect(result.success).toBe(true);
  });

  it('rejects an item that does not match the wrapped schema', () => {
    const schema = paginatedResponseSchema(z.object({ name: z.string() }));
    const result = schema.safeParse({ items: [{ name: 5 }], nextCursor: null });
    expect(result.success).toBe(false);
  });
});

describe('apiErrorSchema', () => {
  it('accepts a minimal error envelope', () => {
    const result = apiErrorSchema.safeParse({
      error: { code: 'VALIDATION_FAILED', message: 'Invalid request' },
    });
    expect(result.success).toBe(true);
  });
});
