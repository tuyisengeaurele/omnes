/**
 * Order module: cart, pricing, order lifecycle state machine, order events,
 * issues, ratings.
 *
 * This file is the module's only public surface. Other modules import from
 * here, never from a sibling file in this directory. Enforced by the
 * boundaries/element-types rule in the root eslint config.
 */

export {
  priceCart,
  type PriceBreakdown,
  type PricingLineItem,
  type FeeScheduleInput,
} from './pricing.js';
export { createCartService, type CartService, type CartView } from './cart.service.js';
export { createCartRouter } from './cart.routes.js';
export {
  createCheckoutService,
  type CheckoutService,
  type CatalogLookup,
  type CheckoutPort,
  type CheckoutOutcome,
} from './checkout.service.js';
export { createCheckoutRouter } from './checkout.routes.js';
export { ORDER_TRANSITIONS, canTransition, isTerminal } from './stateMachine.js';
export {
  transitionOrder,
  type TransitionOrderInput,
  type TransitionOutcome,
} from './lifecycle.repository.js';
export { createOrderLifecycleService, type OrderLifecycleService } from './lifecycle.service.js';
export { createOrderLifecycleRouter } from './lifecycle.routes.js';
export {
  findOrdersForCustomer,
  findOrderDetail,
  findOrderPickupInfo,
  type OrderSummaryRow,
  type OrderDetailRow,
  type OrderPickupInfo,
} from './order.repository.js';
