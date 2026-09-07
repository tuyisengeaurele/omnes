/**
 * Mock SmsPort. Never used in production: config.ts refuses to start with
 * SMS_PROVIDER=mock when NODE_ENV=production, so this file only ever runs
 * in local development or in a test environment.
 *
 * That guarantee is what makes it acceptable for this one file to print the
 * message body straight to the terminal via console, including the OTP code
 * it carries, rather than through the structured logger in
 * platform/logger.ts. A developer needs to see the code somewhere to
 * actually exercise the login flow without a real phone. This goes to the
 * local terminal only, never to a log aggregator, and never runs where a
 * real user's data could appear.
 */

import { randomUUID } from 'node:crypto';
import type { SendSmsInput, SendSmsResult, SmsPort } from './index.js';

export const mockSmsAdapter: SmsPort = {
  send(input: SendSmsInput): Promise<SendSmsResult> {
    console.info(`[mock-sms] to=${input.to} body=${JSON.stringify(input.body)}`);
    return Promise.resolve({ ok: true, providerRef: `mock-${randomUUID()}` });
  },
};
