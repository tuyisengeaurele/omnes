/**
 * The transactional core of checkout: Order, its OrderItems, the initial
 * OrderEvent, and a PaymentIntent, all created in one database transaction.
 * These last two rows belong to the payment module by ownership, but the
 * atomicity requirement ("Order creation inside a transaction", per the
 * build plan) is what matters here, not which module a table is assigned
 * to on paper - Prisma is a single shared database, not something split
 * along the same lines as the TypeScript module boundary. The
 * boundaries/dependencies lint rule polices cross-module *imports*
 * (service and repository functions calling each other); it says nothing
 * about which tables one atomic transaction may touch, and should not,
 * since a workflow that genuinely needs cross-entity atomicity would
 * otherwise have no correct way to get it.
 */

import { randomBytes, randomUUID } from 'node:crypto';
import type { Vertical } from '@omnes/contracts';
import { getDb } from '../../platform/db.js';
import type { PaymentMethod } from '../../adapters/payment/index.js';

export interface CheckoutOrderItemInput {
  productId: string;
  nameSnapshot: string;
  quantity: number;
  unitPriceMinor: bigint;
}

export interface CreateCheckoutInput {
  customerId: string;
  merchantId: string;
  vertical: Vertical;
  addressId: string;
  subtotalMinor: bigint;
  deliveryFeeMinor: bigint;
  serviceFeeMinor: bigint;
  discountMinor: bigint;
  totalMinor: bigint;
  currency: string;
  items: CheckoutOrderItemInput[];
  paymentMethod: PaymentMethod;
  idempotencyKey: string;
}

export interface CreatedCheckout {
  orderId: string;
  orderNumber: string;
  paymentIntentId: string;
}

function generateOrderNumber(): string {
  const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const randomPart = randomBytes(3).toString('hex').toUpperCase();
  return `OM-${datePart}-${randomPart}`;
}

export async function createCheckout(input: CreateCheckoutInput): Promise<CreatedCheckout> {
  const db = getDb();

  return db.$transaction(async (tx) => {
    const order = await tx.order.create({
      data: {
        orderNumber: generateOrderNumber(),
        customerId: input.customerId,
        merchantId: input.merchantId,
        vertical: input.vertical,
        status: 'PENDING_PAYMENT',
        addressId: input.addressId,
        subtotalMinor: input.subtotalMinor,
        deliveryFeeMinor: input.deliveryFeeMinor,
        serviceFeeMinor: input.serviceFeeMinor,
        discountMinor: input.discountMinor,
        totalMinor: input.totalMinor,
        currency: input.currency,
      },
    });

    await tx.orderItem.createMany({
      data: input.items.map((item) => ({
        orderId: order.id,
        productId: item.productId,
        nameSnapshot: item.nameSnapshot,
        quantity: item.quantity,
        unitPriceMinor: item.unitPriceMinor,
      })),
    });

    await tx.orderEvent.create({
      data: {
        orderId: order.id,
        toStatus: 'PENDING_PAYMENT',
        actorType: 'SYSTEM',
        reason: 'checkout submitted',
      },
    });

    const paymentIntent = await tx.paymentIntent.create({
      data: {
        orderId: order.id,
        method: input.paymentMethod,
        amountMinor: input.totalMinor,
        currency: input.currency,
        status: 'PENDING',
        idempotencyKey: input.idempotencyKey,
      },
    });

    return { orderId: order.id, orderNumber: order.orderNumber, paymentIntentId: paymentIntent.id };
  });
}

export interface ExistingCheckout {
  orderId: string;
  orderNumber: string;
  paymentIntentId: string;
  paymentStatus: string;
}

/** Looks up a checkout already submitted under this idempotency key, for a safe double-submit replay. */
export async function findCheckoutByIdempotencyKey(
  idempotencyKey: string
): Promise<ExistingCheckout | null> {
  const intent = await getDb().paymentIntent.findUnique({
    where: { idempotencyKey },
    select: { id: true, status: true, order: { select: { id: true, orderNumber: true } } },
  });
  if (!intent) return null;
  return {
    orderId: intent.order.id,
    orderNumber: intent.order.orderNumber,
    paymentIntentId: intent.id,
    paymentStatus: intent.status,
  };
}

export function generateIdempotencyKey(): string {
  return randomUUID();
}
