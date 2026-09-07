/**
 * PaymentPort: the interface every payment provider adapter implements
 * (MTN Mobile Money, Airtel Money, a card gateway). The mock adapter models
 * real failure modes (async pending state, a webhook callback arriving
 * later, insufficient funds, timeout, duplicate webhook idempotency) so
 * swapping in a real provider is a config change, not a rewrite - and so
 * the code that handles a payment failing never gets written for the
 * first time against a real provider in production.
 *
 * `initiate` only ever reports whether the *request* reached the provider.
 * A real mobile money payment is never confirmed synchronously - the
 * customer has to approve it on their phone - so the actual outcome always
 * arrives later through the webhook, which is why PENDING is the expected
 * result here, not a stand-in for something the port was too lazy to wait
 * for.
 */

export type PaymentMethod = 'MTN_MOMO' | 'AIRTEL';

export interface InitiatePaymentInput {
  amountMinor: bigint;
  currency: string;
  method: PaymentMethod;
  payerPhone: string;
  /** Passed through to the provider so a retried request cannot double-charge. */
  idempotencyKey: string;
}

export type InitiatePaymentResult =
  | { status: 'PENDING'; providerRef: string }
  | { status: 'FAILED'; errorCode: string; errorMessage: string };

export interface PaymentPort {
  initiate(input: InitiatePaymentInput): Promise<InitiatePaymentResult>;
}

/**
 * The shape every provider's webhook is normalized to before it reaches the
 * shared webhook-processing logic. A real provider's adapter is what would
 * translate MTN's or Airtel's own payload and signature scheme into this;
 * the route that receives it never has to know which provider is behind it.
 */
export interface PaymentWebhookPayload {
  providerRef: string;
  status: 'SUCCEEDED' | 'FAILED';
  errorCode?: string;
  errorMessage?: string;
}
