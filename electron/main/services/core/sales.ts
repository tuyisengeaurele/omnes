import { Prisma } from '../../../../generated/prisma/client';
import { getSession } from './auth';
import { prisma } from './database';
import type { CreateSaleInput, Sale, SaleResult } from '@shared/ipc';

interface SaleRow {
  id: string;
  cashierUsername: string | null;
  customerId: string | null;
  customerName: string | null;
  paymentMethod: string;
  amountTendered: number | null;
  changeGiven: number | null;
  total: number;
  createdAt: Date;
  items: {
    id: string;
    productId: string | null;
    productName: string;
    unitPrice: number;
    quantity: number;
  }[];
}

function toSale(row: SaleRow): Sale {
  return {
    id: row.id,
    cashierUsername: row.cashierUsername,
    customerId: row.customerId,
    customerName: row.customerName,
    paymentMethod: row.paymentMethod as Sale['paymentMethod'],
    amountTendered: row.amountTendered,
    changeGiven: row.changeGiven,
    total: row.total,
    createdAt: row.createdAt.toISOString(),
    items: row.items.map((item) => ({
      id: item.id,
      productId: item.productId,
      productName: item.productName,
      unitPrice: item.unitPrice,
      quantity: item.quantity,
    })),
  };
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2034') {
      return 'Checkout conflicted with another sale in progress. Please try again.';
    }
    // Defense-in-depth: the cashier-existence check inside the transaction
    // below is what's meant to prevent this, but a raw FK violation should
    // never leak to the cashier as a Prisma internals string if some other
    // path ever triggers one.
    if (error.code === 'P2003') {
      return 'Could not complete the sale. Please try again.';
    }
  }
  return error instanceof Error ? error.message : String(error);
}

export async function createSale(input: CreateSaleInput): Promise<SaleResult> {
  if (input.items.length === 0) {
    return { success: false, message: 'Cart is empty', sale: null };
  }

  try {
    const session = getSession();

    const row = await prisma.$transaction(
      async (tx) => {
        // A live session's userId can outlive its own User row — most
        // plausibly, an admin restores a backup taken before this cashier's
        // account existed while the cashier is mid-shift. Checking inside
        // this same transaction (not before it starts) means the check and
        // the insert that relies on it are atomic together — a stale
        // reference degrades to an unattributed sale (like AuditLog's own
        // SetNull design) rather than a race window where the row could
        // disappear between an outside check and the insert.
        const cashierId = session
          ? ((await tx.user.findUnique({ where: { id: session.userId }, select: { id: true } }))
              ?.id ?? null)
          : null;

        // Same reasoning as cashierId above: a customerId selected in the
        // renderer moments earlier could reference a row that no longer
        // exists by the time checkout actually runs (most plausibly the
        // same restore-mid-shift scenario). Resolved inside this
        // transaction, with the same graceful degrade to an unattributed
        // sale rather than a failed checkout.
        const customer = input.customerId
          ? await tx.customer.findUnique({
              where: { id: input.customerId },
              select: { id: true, name: true },
            })
          : null;

        let total = 0;
        const lineData: {
          productId: string;
          productName: string;
          unitPrice: number;
          quantity: number;
        }[] = [];

        for (const line of input.items) {
          if (line.quantity <= 0) {
            throw new Error('Quantity must be at least 1');
          }
          const product = await tx.product.findUnique({ where: { id: line.productId } });
          if (!product) {
            throw new Error('A product in the cart no longer exists');
          }
          if (product.stockQuantity < line.quantity) {
            throw new Error(`${product.name} is out of stock`);
          }
          total += product.price * line.quantity;
          lineData.push({
            productId: product.id,
            productName: product.name,
            unitPrice: product.price,
            quantity: line.quantity,
          });
          await tx.product.update({
            where: { id: product.id },
            data: { stockQuantity: { decrement: line.quantity } },
          });
        }

        let changeGiven: number | null = null;
        if (input.paymentMethod === 'CASH') {
          if (input.amountTendered === null || input.amountTendered < total) {
            throw new Error('Amount tendered is less than the total');
          }
          changeGiven = input.amountTendered - total;
        }

        return tx.sale.create({
          data: {
            cashierId,
            cashierUsername: session?.username ?? null,
            customerId: customer?.id ?? null,
            customerName: customer?.name ?? null,
            paymentMethod: input.paymentMethod,
            amountTendered: input.paymentMethod === 'CASH' ? input.amountTendered : null,
            changeGiven,
            total,
            items: { create: lineData },
          },
          include: { items: true },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    return { success: true, message: 'Sale completed', sale: toSale(row) };
  } catch (error) {
    return { success: false, message: toErrorMessage(error), sale: null };
  }
}

export async function listSales(customerId?: string): Promise<Sale[]> {
  const rows = await prisma.sale.findMany({
    where: customerId ? { customerId } : undefined,
    include: { items: true },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map(toSale);
}

export async function getSale(id: string): Promise<Sale | null> {
  const row = await prisma.sale.findUnique({ where: { id }, include: { items: true } });
  return row ? toSale(row) : null;
}
