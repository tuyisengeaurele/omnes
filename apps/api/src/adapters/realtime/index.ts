/**
 * RealtimePort: pushes an order's status changes to whoever is watching it
 * live. REALTIME_TRANSPORT in config.ts names the wire protocol a route
 * exposes this over (SSE for now, a websocket adapter is a later config
 * change behind the same interface) - this port itself is transport-agnostic
 * publish/subscribe, not tied to either.
 */

export interface OrderStatusEvent {
  orderId: string;
  status: string;
  occurredAt: string;
}

export type OrderStatusListener = (event: OrderStatusEvent) => void;

export interface RealtimePort {
  publishOrderStatus(event: OrderStatusEvent): void;
  /** Returns an unsubscribe function. Call it when the client disconnects. */
  subscribeToOrder(orderId: string, listener: OrderStatusListener): () => void;
}
