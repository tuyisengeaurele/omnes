/**
 * Read side of the order module: history and detail lookups. Separate from
 * checkout.repository.ts (which only ever creates an order) and
 * lifecycle.repository.ts (which only ever transitions one), so each file
 * stays focused on one kind of access to the same table.
 */

import { getDb } from '../../platform/db.js';
import type { OrderStatus } from '../../generated/prisma/index.js';

export interface OrderSummaryRow {
  id: string;
  orderNumber: string;
  merchantId: string;
  merchantName: string;
  status: OrderStatus;
  totalMinor: bigint;
  currency: string;
  placedAt: Date;
}

const ORDER_SUMMARY_SELECT = {
  id: true,
  orderNumber: true,
  merchantId: true,
  merchant: { select: { name: true } },
  status: true,
  totalMinor: true,
  currency: true,
  placedAt: true,
} as const;

function toSummaryRow(row: {
  id: string;
  orderNumber: string;
  merchantId: string;
  merchant: { name: string };
  status: OrderStatus;
  totalMinor: bigint;
  currency: string;
  placedAt: Date;
}): OrderSummaryRow {
  return {
    id: row.id,
    orderNumber: row.orderNumber,
    merchantId: row.merchantId,
    merchantName: row.merchant.name,
    status: row.status,
    totalMinor: row.totalMinor,
    currency: row.currency,
    placedAt: row.placedAt,
  };
}

/**
 * A customer's own order history, most recent first. Cursor pagination on
 * id, same pattern as catalog's findMerchantsPage - see that file's comment
 * on why id is always the tiebreak.
 */
export async function findOrdersForCustomer(params: {
  customerId: string;
  cursor?: string;
  limit: number;
}): Promise<{ items: OrderSummaryRow[]; nextCursor: string | null }> {
  const rows = await getDb().order.findMany({
    where: { customerId: params.customerId },
    select: ORDER_SUMMARY_SELECT,
    orderBy: [{ placedAt: 'desc' }, { id: 'desc' }],
    take: params.limit + 1,
    ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
  });

  const hasMore = rows.length > params.limit;
  const page = hasMore ? rows.slice(0, params.limit) : rows;
  const last = page[page.length - 1];

  return {
    items: page.map(toSummaryRow),
    nextCursor: hasMore && last ? last.id : null,
  };
}

export interface OrderDetailRow extends OrderSummaryRow {
  customerId: string;
  subtotalMinor: bigint;
  deliveryFeeMinor: bigint;
  serviceFeeMinor: bigint;
  discountMinor: bigint;
  items: Array<{
    id: string;
    productId: string;
    nameSnapshot: string;
    quantity: number;
    unitPriceMinor: bigint;
  }>;
}

export async function findOrderDetail(orderId: string): Promise<OrderDetailRow | null> {
  const row = await getDb().order.findUnique({
    where: { id: orderId },
    select: {
      ...ORDER_SUMMARY_SELECT,
      customerId: true,
      subtotalMinor: true,
      deliveryFeeMinor: true,
      serviceFeeMinor: true,
      discountMinor: true,
      items: {
        select: {
          id: true,
          productId: true,
          nameSnapshot: true,
          quantity: true,
          unitPriceMinor: true,
        },
      },
    },
  });
  if (!row) return null;

  return {
    ...toSummaryRow(row),
    customerId: row.customerId,
    subtotalMinor: row.subtotalMinor,
    deliveryFeeMinor: row.deliveryFeeMinor,
    serviceFeeMinor: row.serviceFeeMinor,
    discountMinor: row.discountMinor,
    items: row.items,
  };
}
