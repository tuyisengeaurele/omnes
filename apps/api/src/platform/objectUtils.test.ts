import { describe, expect, it } from 'vitest';
import { omitUndefined } from './objectUtils.js';

describe('omitUndefined', () => {
  it('removes keys whose value is undefined', () => {
    const result = omitUndefined({ a: 1, b: undefined });
    expect(result).toEqual({ a: 1 });
    expect('b' in result).toBe(false);
  });

  it('keeps a key whose value is explicitly null', () => {
    const result = omitUndefined({ a: null, b: undefined });
    expect(result).toEqual({ a: null });
    expect('a' in result).toBe(true);
  });

  it('keeps falsy-but-defined values', () => {
    const result = omitUndefined({ a: 0, b: '', c: false, d: undefined });
    expect(result).toEqual({ a: 0, b: '', c: false });
  });

  it('returns an empty object when every value is undefined', () => {
    expect(omitUndefined({ a: undefined, b: undefined })).toEqual({});
  });

  it('returns an equivalent object when nothing is undefined', () => {
    expect(omitUndefined({ a: 1, b: 'x' })).toEqual({ a: 1, b: 'x' });
  });
});
