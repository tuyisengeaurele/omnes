import { describe, expect, it } from 'vitest';
import { Writable } from 'node:stream';
import pino from 'pino';
import { redactConfig } from './logger.js';

/**
 * Importing logger.ts for redactConfig never calls getConfig(), since that
 * only happens inside createLogger(), so this file never needs a valid
 * process.env. What is tested here is pino's actual behavior with the real
 * redact config the app ships, piped into an in-memory sink and asserted
 * against, not a re-implementation of it.
 */

function captureLogger() {
  const lines: string[] = [];
  const sink = new Writable({
    write(chunk: Buffer, _enc, cb) {
      lines.push(chunk.toString());
      cb();
    },
  });
  const logger = pino({ redact: redactConfig }, sink);
  return { logger, lines: () => lines.map((l) => JSON.parse(l) as Record<string, unknown>) };
}

describe('logger redaction', () => {
  it('redacts a top-level otpCode field', () => {
    const { logger, lines } = captureLogger();
    logger.info({ otpCode: '482913' }, 'otp issued');
    expect(lines()[0]?.otpCode).toBe('[Redacted]');
  });

  it('redacts a nested password field one level deep', () => {
    const { logger, lines } = captureLogger();
    logger.info({ credential: { password: 'hunter2' } }, 'login attempt');
    expect((lines()[0]?.credential as Record<string, unknown>).password).toBe('[Redacted]');
  });

  it('redacts an authorization header', () => {
    const { logger, lines } = captureLogger();
    logger.info({ req: { headers: { authorization: 'Bearer xyz' } } }, 'request');
    const req = lines()[0]?.req as { headers: Record<string, unknown> };
    expect(req.headers.authorization).toBe('[Redacted]');
  });

  it('redacts a national ID and a card number wherever they appear', () => {
    const { logger, lines } = captureLogger();
    logger.info(
      {
        verification: { nationalId: '1198012345678' },
        payment: { cardNumber: '4111111111111111' },
      },
      'sensitive fields'
    );
    const line = lines()[0];
    expect((line?.verification as Record<string, unknown>).nationalId).toBe('[Redacted]');
    expect((line?.payment as Record<string, unknown>).cardNumber).toBe('[Redacted]');
  });

  it('redacts a refresh token nested two levels deep', () => {
    const { logger, lines } = captureLogger();
    logger.info({ session: { tokens: { refreshToken: 'abc.def.ghi' } } }, 'session created');
    const session = lines()[0]?.session as { tokens: Record<string, unknown> };
    expect(session.tokens.refreshToken).toBe('[Redacted]');
  });

  it('does not redact an unrelated field', () => {
    const { logger, lines } = captureLogger();
    logger.info({ orderId: 'abc-123', status: 'PLACED' }, 'order placed');
    expect(lines()[0]?.orderId).toBe('abc-123');
    expect(lines()[0]?.status).toBe('PLACED');
  });
});
