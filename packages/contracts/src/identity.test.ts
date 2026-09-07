import { describe, expect, it } from 'vitest';
import { loginSchema, registerSchema, requestOtpSchema } from './identity.js';

describe('requestOtpSchema', () => {
  it('accepts a valid phone number', () => {
    expect(requestOtpSchema.safeParse({ phoneE164: '+250780000000' }).success).toBe(true);
  });

  it('rejects a missing phone number', () => {
    expect(requestOtpSchema.safeParse({}).success).toBe(false);
  });
});

describe('registerSchema', () => {
  it('accepts a valid registration payload', () => {
    const result = registerSchema.safeParse({
      phoneE164: '+250780000000',
      displayName: 'Aurele T',
      code: '482913',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an empty display name', () => {
    const result = registerSchema.safeParse({
      phoneE164: '+250780000000',
      displayName: '   ',
      code: '482913',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a non-numeric code', () => {
    const result = registerSchema.safeParse({
      phoneE164: '+250780000000',
      displayName: 'Aurele T',
      code: 'abcdef',
    });
    expect(result.success).toBe(false);
  });
});

describe('loginSchema', () => {
  it('accepts a valid login payload', () => {
    expect(loginSchema.safeParse({ phoneE164: '+250780000000', code: '123456' }).success).toBe(
      true
    );
  });

  it('rejects a code that is too short', () => {
    expect(loginSchema.safeParse({ phoneE164: '+250780000000', code: '12' }).success).toBe(false);
  });
});
