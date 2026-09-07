/**
 * Environment configuration, validated once at process start.
 *
 * A misconfigured deploy should fail loudly here, before the server binds a
 * port, rather than quietly at the first request that happens to need the
 * missing value. `loadConfig` is a pure function of an env-like object so it
 * can be tested without touching the real `process.env`; `config` below is
 * the one instance the rest of the app imports.
 */

import { z } from 'zod';

const commaSeparatedList = z
  .string()
  .transform((value) =>
    value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  )
  .pipe(z.array(z.string()).min(1, 'must list at least one origin'));

const booleanFromString = z
  .string()
  .transform((v) => v.toLowerCase())
  .pipe(z.enum(['true', 'false']))
  .transform((v) => v === 'true');

/**
 * A secret loaded straight from the environment. 32 chars is a floor, not a
 * recommendation: `openssl rand -hex 32` produces 64. This exists so an
 * empty string or a copy-pasted "replace-me" placeholder fails startup
 * instead of silently becoming the signing key.
 */
const secretSchema = z.string().min(32, 'must be at least 32 characters, generate with openssl rand -hex 32');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  JWT_ACCESS_SECRET: secretSchema,
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),

  // Keys the HMAC used to hash OTP codes at rest. A distinct secret rather
  // than reusing JWT_ACCESS_SECRET, so a leak of one does not also expose
  // the other: an attacker with only the OTP pepper cannot forge sessions,
  // and one with only the JWT secret cannot brute-force stored OTP hashes
  // offline against the small numeric keyspace.
  OTP_PEPPER: secretSchema,

  CSRF_SECRET: secretSchema,
  COOKIE_DOMAIN: z.string().optional(),
  COOKIE_SECURE: booleanFromString.default(false),

  CORS_ALLOWED_ORIGINS: commaSeparatedList,

  OTP_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  OTP_LENGTH: z.coerce.number().int().min(4).max(10).default(6),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  OTP_REQUESTS_PER_HOUR: z.coerce.number().int().positive().default(5),

  PAYMENT_PROVIDER: z.enum(['mock', 'mtn_momo', 'airtel']).default('mock'),
  SMS_PROVIDER: z.enum(['mock', 'live']).default('mock'),
  MAPS_PROVIDER: z.enum(['osm', 'mapbox', 'google']).default('osm'),
  REALTIME_TRANSPORT: z.enum(['sse', 'websocket']).default('sse'),

  RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(120),
  RATE_LIMIT_AUTH_MAX_REQUESTS: z.coerce.number().int().positive().default(10),
});

export type Config = z.infer<typeof envSchema>;

export class ConfigError extends Error {
  constructor(issues: z.ZodIssue[]) {
    const lines = issues.map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`);
    super(`invalid environment configuration:\n${lines.join('\n')}`);
    this.name = 'ConfigError';
  }
}

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    throw new ConfigError(result.error.issues);
  }

  const config = result.data;

  // A production deploy over plain HTTP would ship the access token cookie
  // without the Secure flag, which is the one setting that actually keeps it
  // off the wire in cleartext. This check exists so that mistake fails
  // startup rather than shipping.
  if (config.NODE_ENV === 'production' && !config.COOKIE_SECURE) {
    throw new ConfigError([
      {
        code: 'custom',
        path: ['COOKIE_SECURE'],
        message: 'must be true when NODE_ENV=production',
      },
    ]);
  }

  return config;
}

let cached: Config | undefined;

/**
 * The process-wide config, computed from `process.env` on first call and
 * memoized after. Lazy rather than a top-level `export const` so that
 * importing this module - including from a test file, or from a module
 * that only wants `loadConfig` itself - never touches the real environment
 * as a side effect of the import. The real server calls this once at
 * startup, which is where "fail fast" actually needs to happen.
 */
export function getConfig(): Config {
  cached ??= loadConfig(process.env);
  return cached;
}
