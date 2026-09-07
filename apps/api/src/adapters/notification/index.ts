/**
 * NotificationPort: tells a user something happened to their order. Unlike
 * SmsPort and PaymentPort, the MVP-scoped implementation of this one is not
 * a mock standing in for a later real provider - the build plan's scope for
 * this phase is exactly "NotificationPort with a logging adapter", so the
 * logging adapter is meant to run in every environment, including
 * production, until push or SMS delivery is built behind this same
 * interface.
 */

export interface NotifyInput {
  userId: string;
  title: string;
  body: string;
}

export interface NotificationPort {
  notify(input: NotifyInput): Promise<void>;
}
