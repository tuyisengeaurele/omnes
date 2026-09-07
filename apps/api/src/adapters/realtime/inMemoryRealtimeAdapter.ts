/**
 * In-process RealtimePort. Correct for exactly one API instance: a customer
 * watching their order is connected to that same process's event emitter,
 * which is all this deployment has. The moment there is more than one API
 * instance behind a load balancer, an SSE client connected to instance A
 * would never see a publish that happened to land on instance B - at that
 * point this needs a shared pub/sub (Redis, most likely) behind the same
 * RealtimePort interface, matching the note on rateLimit.ts's in-memory
 * store for the same reason.
 *
 * One Node EventEmitter, topic-keyed by orderId as the event name. Each
 * order realistically has one or two live listeners (the customer's own
 * open tabs), never the dozens that would call for raising
 * defaultMaxListeners.
 */

import { EventEmitter } from 'node:events';
import type { OrderStatusEvent, OrderStatusListener, RealtimePort } from './index.js';

export function createInMemoryRealtimeAdapter(): RealtimePort {
  const emitter = new EventEmitter();

  return {
    publishOrderStatus(event: OrderStatusEvent): void {
      emitter.emit(event.orderId, event);
    },
    subscribeToOrder(orderId: string, listener: OrderStatusListener): () => void {
      emitter.on(orderId, listener);
      return () => emitter.off(orderId, listener);
    },
  };
}
