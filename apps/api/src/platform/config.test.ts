import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './config.js';

const SECRET_A = 'a'.repeat(32);
const SECRET_B = 'b'.repeat(32);
const SECRET_C = 'c'.repeat(32);

function validEnv(overrides: Partial<NodeJS.ProcessEnv> = {}): NodeJS.ProcessEnv {
  return {
    DATABASE_URL: 'postgresql://user:placeholder@localhost:5432/db',
    JWT_ACCESS_SECRET: SECRET_A,
    CSRF_SECRET: SECRET_B,
    OTP_PEPPER: SECRET_C,
    CORS_ALLOWED_ORIGINS: 'http://localhost:5173,http://localhost:5174',
    ...overrides,
  };
}

describe('loadConfig', () => {
  it('accepts a minimal valid environment and applies defaults', () => {
    const config = loadConfig(validEnv());
    expect(config.NODE_ENV).toBe('development');
    expect(config.API_PORT).toBe(4000);
    expect(config.JWT_ACCESS_TTL_SECONDS).toBe(900);
    expect(config.PAYMENT_PROVIDER).toBe('mock');
  });

  it('parses a comma-separated origin list into an array, trimming whitespace', () => {
    const config = loadConfig(
      validEnv({ CORS_ALLOWED_ORIGINS: ' http://a.test , http://b.test ' })
    );
    expect(config.CORS_ALLOWED_ORIGINS).toEqual(['http://a.test', 'http://b.test']);
  });

  it('rejects a missing DATABASE_URL', () => {
    const env = validEnv();
    delete env.DATABASE_URL;
    expect(() => loadConfig(env)).toThrow(ConfigError);
  });

  it('rejects a JWT secret shorter than 32 characters', () => {
    expect(() => loadConfig(validEnv({ JWT_ACCESS_SECRET: 'too-short' }))).toThrow(ConfigError);
  });

  it('rejects an empty CORS origin list rather than defaulting to none', () => {
    expect(() => loadConfig(validEnv({ CORS_ALLOWED_ORIGINS: '' }))).toThrow(ConfigError);
  });

  it('rejects an unrecognized NODE_ENV rather than silently defaulting', () => {
    expect(() => loadConfig(validEnv({ NODE_ENV: 'staging' }))).toThrow(ConfigError);
  });

  it('coerces numeric env vars from string to number', () => {
    const config = loadConfig(validEnv({ API_PORT: '8080', OTP_LENGTH: '4' }));
    expect(config.API_PORT).toBe(8080);
    expect(config.OTP_LENGTH).toBe(4);
  });

  it('rejects a non-numeric value for a numeric field', () => {
    expect(() => loadConfig(validEnv({ API_PORT: 'not-a-number' }))).toThrow(ConfigError);
  });

  it('parses COOKIE_SECURE as a boolean, case-insensitively', () => {
    expect(loadConfig(validEnv({ COOKIE_SECURE: 'TRUE' })).COOKIE_SECURE).toBe(true);
    expect(loadConfig(validEnv({ COOKIE_SECURE: 'false' })).COOKIE_SECURE).toBe(false);
  });

  it('refuses to start in production without COOKIE_SECURE=true', () => {
    expect(() =>
      loadConfig(validEnv({ NODE_ENV: 'production', COOKIE_SECURE: 'false' }))
    ).toThrow(ConfigError);
  });

  it('allows production with COOKIE_SECURE=true', () => {
    expect(() =>
      loadConfig(validEnv({ NODE_ENV: 'production', COOKIE_SECURE: 'true' }))
    ).not.toThrow();
  });

  it('lists every invalid field in one error rather than failing on the first', () => {
    const env = validEnv({ JWT_ACCESS_SECRET: 'short', CSRF_SECRET: 'also-short' });
    delete env.DATABASE_URL;
    try {
      loadConfig(env);
      expect.unreachable('loadConfig should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      const message = (err as ConfigError).message;
      expect(message).toContain('DATABASE_URL');
      expect(message).toContain('JWT_ACCESS_SECRET');
      expect(message).toContain('CSRF_SECRET');
    }
  });
});
