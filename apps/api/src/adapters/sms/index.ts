/**
 * SmsPort: the interface every SMS gateway adapter implements. The mock
 * implementation logs to the terminal instead of sending, but is wired the
 * same way a real provider would be, so swapping SMS_PROVIDER=mock for a
 * real gateway is a config change, not a rewrite.
 */

export interface SendSmsInput {
  to: string;
  body: string;
}

export type SendSmsResult = { ok: true; providerRef: string } | { ok: false; error: string };

export interface SmsPort {
  send(input: SendSmsInput): Promise<SendSmsResult>;
}
