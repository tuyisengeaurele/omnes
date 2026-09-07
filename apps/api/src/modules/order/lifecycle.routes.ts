/**
 * Order history, detail, live tracking and the merchant/customer actions
 * that move an order through its lifecycle. Authenticates against the
 * 'customer' audience for every route, same reasoning as catalog's write
 * routes: a merchant owner or ops user logs in through the same phone+OTP
 * flow a customer does, and RBAC plus the ownership checks below decide
 * what they may actually do, not which audience issued the token.
 */

import { Router, type Response } from 'express';
import { orderActionReasonSchema, paginationQuerySchema } from '@omnes/contracts';
import { requireAuth, type TokenService } from '../identity/index.js';
import { assertMerchantAccess } from '../catalog/index.js';
import type { RealtimePort } from '../../adapters/realtime/index.js';
import { csrfProtection } from '../../platform/csrf.js';
import { conflict, forbidden, notFound, unauthorized } from '../../platform/errors.js';
import type { Actor } from '../../platform/actor.js';
import * as orderRepo from './order.repository.js';
import type { OrderDetailRow, OrderSummaryRow } from './order.repository.js';
import type { OrderLifecycleService } from './lifecycle.service.js';

function serializeMoney(minor: bigint, currency: string) {
  return { amountMinor: minor.toString(), currency };
}

function serializeSummary(row: OrderSummaryRow) {
  return {
    id: row.id,
    orderNumber: row.orderNumber,
    merchantId: row.merchantId,
    merchantName: row.merchantName,
    status: row.status,
    total: serializeMoney(row.totalMinor, row.currency),
    placedAt: row.placedAt.toISOString(),
  };
}

function serializeDetail(row: OrderDetailRow) {
  return {
    ...serializeSummary(row),
    subtotal: serializeMoney(row.subtotalMinor, row.currency),
    deliveryFee: serializeMoney(row.deliveryFeeMinor, row.currency),
    serviceFee: serializeMoney(row.serviceFeeMinor, row.currency),
    discount: serializeMoney(row.discountMinor, row.currency),
    items: row.items.map((item) => ({
      id: item.id,
      productId: item.productId,
      name: item.nameSnapshot,
      quantity: item.quantity,
      unitPrice: serializeMoney(item.unitPriceMinor, row.currency),
    })),
  };
}

/** The customer who placed the order, or anyone with write access to its merchant. */
async function assertViewAccess(actor: Actor, order: { customerId: string; merchantId: string }) {
  if (actor.userId === order.customerId) return;
  await assertMerchantAccess(actor, order.merchantId);
}

const STAFF_ROLES = new Set(['OPS', 'SUPER_ADMIN']);

async function loadOrderOrThrow(orderId: string): Promise<OrderDetailRow> {
  const order = await orderRepo.findOrderDetail(orderId);
  if (!order) throw notFound('ORDER_NOT_FOUND', 'No order matches this id.');
  return order;
}

function transitionFailureError(
  outcome: Extract<Awaited<ReturnType<OrderLifecycleService['transition']>>, { applied: false }>
) {
  if (outcome.reason === 'NOT_FOUND') {
    return notFound('ORDER_NOT_FOUND', 'No order matches this id.');
  }
  if (outcome.reason === 'CONCURRENT_MODIFICATION') {
    return conflict(
      'ORDER_MODIFIED_CONCURRENTLY',
      'This order changed while the request was in flight. Reload and try again.'
    );
  }
  return conflict(
    'ILLEGAL_ORDER_TRANSITION',
    `This order cannot move from ${outcome.from} to the requested status.`
  );
}

export function createOrderLifecycleRouter(
  lifecycle: OrderLifecycleService,
  realtime: RealtimePort,
  tokenService: TokenService
): Router {
  const router = Router();
  router.use(requireAuth('customer', tokenService));
  router.use(csrfProtection('customer'));

  router.get('/', async (req, res) => {
    const actor = req.actor;
    if (!actor) throw unauthorized('UNAUTHENTICATED', 'Authentication required.');

    const query = paginationQuerySchema.parse(req.query);
    const page = await orderRepo.findOrdersForCustomer({
      customerId: actor.userId,
      ...(query.cursor ? { cursor: query.cursor } : {}),
      limit: query.limit,
    });

    res.status(200).json({ items: page.items.map(serializeSummary), nextCursor: page.nextCursor });
  });

  router.get('/:id', async (req, res) => {
    const actor = req.actor;
    if (!actor) throw unauthorized('UNAUTHENTICATED', 'Authentication required.');

    const order = await loadOrderOrThrow(req.params.id);
    await assertViewAccess(actor, order);

    res.status(200).json({ order: serializeDetail(order) });
  });

  router.get('/:id/stream', async (req, res: Response) => {
    const actor = req.actor;
    if (!actor) throw unauthorized('UNAUTHENTICATED', 'Authentication required.');

    const order = await loadOrderOrThrow(req.params.id);
    await assertViewAccess(actor, order);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    const send = (event: string, data: unknown): void => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    // The status as of the moment the stream opened, so a client that
    // missed every earlier event still starts from something correct
    // rather than waiting indefinitely for the next transition.
    send('status', {
      orderId: order.id,
      status: order.status,
      occurredAt: new Date().toISOString(),
    });

    const unsubscribe = realtime.subscribeToOrder(order.id, (event) => {
      send('status', event);
    });

    // Keeps the connection alive through proxies that close an idle
    // response; a comment line is invisible to EventSource's onmessage.
    const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 25000);

    req.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });

  router.post('/:id/accept', async (req, res) => {
    const actor = req.actor;
    if (!actor) throw unauthorized('UNAUTHENTICATED', 'Authentication required.');

    const order = await loadOrderOrThrow(req.params.id);
    await assertMerchantAccess(actor, order.merchantId);

    const outcome = await lifecycle.transition({
      orderId: order.id,
      orderNumber: order.orderNumber,
      to: 'ACCEPTED',
      actorType: 'MERCHANT',
      actorId: actor.userId,
    });
    if (!outcome.applied) throw transitionFailureError(outcome);

    res.status(200).json({ status: outcome.to });
  });

  router.post('/:id/reject', async (req, res) => {
    const actor = req.actor;
    if (!actor) throw unauthorized('UNAUTHENTICATED', 'Authentication required.');

    // req.body is undefined, not {}, when a client sends this request with
    // no body at all (no Content-Type: application/json) - every field on
    // orderActionReasonSchema is optional, so that should parse the same
    // as an empty body, not fail validation.
    const input = orderActionReasonSchema.parse(req.body ?? {});
    const order = await loadOrderOrThrow(req.params.id);
    await assertMerchantAccess(actor, order.merchantId);

    const outcome = await lifecycle.transition({
      orderId: order.id,
      orderNumber: order.orderNumber,
      to: 'REJECTED',
      actorType: 'MERCHANT',
      actorId: actor.userId,
      ...(input.reason !== undefined ? { reason: input.reason } : {}),
    });
    if (!outcome.applied) throw transitionFailureError(outcome);

    res.status(200).json({ status: outcome.to });
  });

  router.post('/:id/cancel', async (req, res) => {
    const actor = req.actor;
    if (!actor) throw unauthorized('UNAUTHENTICATED', 'Authentication required.');

    const input = orderActionReasonSchema.parse(req.body ?? {});
    const order = await loadOrderOrThrow(req.params.id);
    const isOwnCustomer = actor.userId === order.customerId;
    const isStaff = actor.roles.some((role) => STAFF_ROLES.has(role));
    if (!isOwnCustomer && !isStaff) {
      throw forbidden('FORBIDDEN', 'You do not have permission to cancel this order.');
    }

    const outcome = await lifecycle.transition({
      orderId: order.id,
      orderNumber: order.orderNumber,
      to: 'CANCELLED',
      actorType: isOwnCustomer ? 'CUSTOMER' : 'OPS',
      actorId: actor.userId,
      ...(input.reason !== undefined ? { reason: input.reason } : {}),
    });
    if (!outcome.applied) throw transitionFailureError(outcome);

    res.status(200).json({ status: outcome.to });
  });

  return router;
}
