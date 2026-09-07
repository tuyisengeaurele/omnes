/**
 * Logs a notification through the structured logger rather than sending it
 * anywhere. This is the real MVP implementation, not a placeholder: nothing
 * in this deployable can reach a push token or an SMS gateway for a general
 * notification yet, so a durable, greppable log line is what a customer's
 * "order accepted" notice becomes for now. Swapping in a push or SMS
 * adapter later is a config change behind NotificationPort, not a rewrite
 * of anything that calls notify().
 */

import type { Logger } from 'pino';
import type { NotificationPort, NotifyInput } from './index.js';

export function createLoggingNotificationAdapter(logger: Logger): NotificationPort {
  return {
    notify(input: NotifyInput): Promise<void> {
      logger.info(
        { userId: input.userId, title: input.title, body: input.body },
        'notification sent'
      );
      return Promise.resolve();
    },
  };
}
