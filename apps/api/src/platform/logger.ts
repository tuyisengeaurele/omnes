/**
 * Structured logging. NFR-OBS-001 and the security checklist both require
 * this: every critical flow emits structured logs, and none of them ever
 * carry an OTP, a token, a card number, or a national ID, even at debug
 * level.
 *
 * That guarantee is enforced by pino's `redact` option below, not by
 * discipline at each call site. A call site can log a whole object without
 * checking it field by field; anything matching a redact path comes out as
 * "[Redacted]" regardless of how deep it sits or what logged it.
 */

import pino from 'pino';
import { getConfig } from './config.js';

/**
 * Paths pino redacts wherever they appear in a logged object, one level deep
 * with a wildcard for the field name and a second wildcard for one level of
 * nesting, since request/response bodies and Prisma payloads are the most
 * likely place a sensitive field shows up nested under a property name we
 * do not control (e.g. `body.otpCode`, `user.credential.secretHash`).
 */
const REDACT_FIELD_NAMES = [
  'password',
  'passwordHash',
  'otp',
  'otpCode',
  'code',
  'codeHash',
  'secret',
  'secretHash',
  'token',
  'accessToken',
  'refreshToken',
  'tokenHash',
  'authorization',
  'cookie',
  'setCookie',
  'nationalId',
  'idNumber',
  'cardNumber',
  'pan',
  'cvv',
  'cvc',
  'phoneE164',
  'email',
];

export function redactPaths(fields: string[]): string[] {
  const paths: string[] = [];
  for (const field of fields) {
    paths.push(field, `*.${field}`, `*.*.${field}`, `req.headers.${field}`, `req.body.${field}`);
  }
  return paths;
}

/**
 * The exact redact config createLogger passes to pino. Exported so tests can
 * exercise it directly against a real pino instance without going through
 * createLogger/getConfig - importing this module for its constants must
 * never touch process.env.
 */
export const redactConfig = {
  paths: redactPaths(REDACT_FIELD_NAMES),
  censor: '[Redacted]',
};

export function createLogger(): pino.Logger {
  const config = getConfig();

  // Built conditionally, rather than passing `transport: undefined` in
  // production, because pino's LoggerOptions type does not accept undefined
  // for this property under exactOptionalPropertyTypes - the key must be
  // absent, not present with an undefined value.
  const transport =
    config.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } }
      : undefined;

  return pino({
    level: config.LOG_LEVEL,
    redact: redactConfig,
    formatters: {
      level: (label) => ({ level: label }),
    },
    // Human-readable in local dev, structured JSON in every other
    // environment; a log aggregator needs the JSON, a terminal does not.
    ...(transport ? { transport } : {}),
  });
}

let cached: pino.Logger | undefined;

export function getLogger(): pino.Logger {
  cached ??= createLogger();
  return cached;
}
