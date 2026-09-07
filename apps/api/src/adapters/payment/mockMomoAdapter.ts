/**
 * Mock PaymentPort. Never used in production: config.ts refuses to start
 * with PAYMENT_PROVIDER=mock when NODE_ENV=production, matching the same
 * guarantee the mock SMS adapter relies on.
 *
 * A real MTN/Airtel payment is never confirmed synchronously - the outcome
 * always arrives later through a webhook once the customer approves or
 * declines on their phone - so this returns PENDING for a normal request,
 * the same as the real integration would. There is one deliberate
 * synchronous escape hatch: a payer phone ending in the magic suffix below
 * simulates an immediate provider-side rejection, the way sandbox
 * environments for real mobile money gateways commonly expose predictable
 * failure cases for testing (mirroring how test card numbers work for card
 * gateways).
 */

import { randomUUID } from 'node:crypto';
import type { InitiatePaymentInput, InitiatePaymentResult, PaymentPort } from './index.js';

const INSUFFICIENT_FUNDS_SUFFIX = '0000';

export const mockMomoAdapter: PaymentPort = {
  initiate(input: InitiatePaymentInput): Promise<InitiatePaymentResult> {
    if (input.payerPhone.endsWith(INSUFFICIENT_FUNDS_SUFFIX)) {
      return Promise.resolve({
        status: 'FAILED',
        errorCode: 'INSUFFICIENT_FUNDS',
        errorMessage: 'The payer does not have enough balance to complete this payment.',
      });
    }

    return Promise.resolve({ status: 'PENDING', providerRef: `mock-momo-${randomUUID()}` });
  },
};
