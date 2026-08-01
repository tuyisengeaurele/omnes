import { Prisma } from '../../../../generated/prisma/client';
import { getSession } from './auth';
import { prisma } from './database';
import type { CreateSaleInput, Sale, SaleResult } from '@shared/ipc';

interface SaleRow {
  id: string;
  cashierUsername: string | null;
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
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
    return 'Checkout conflicted with another sale in progress. Please try again.';
  }
  return error instanceof Error ? error.message : String(error);
}

export async function createSale(input: CreateSaleInput): Promise<SaleResult> {
  if (input.items.length === 0) {
    return { success: false, message: 'Cart is empty', sale: null };
  }

  try {
    const session = getSession();
    // A live session's userId can outlive its own User row — most
    // plausibly, an admin restores a backup taken before this cashier's
    // account existed while the cashier is mid-shift. Verifying first
    // means a stale reference degrades to an unattributed sale (like
    // AuditLog's own SetNull design) rather than crashing the checkout
    // with a raw foreign-key violation.
    const cashierId = session
      ? ((await prisma.user.findUnique({ where: { id: session.userId }, select: { id: true } }))
          ?.id ?? null)
      : null;

    const row = await prisma.$transaction(
      async (tx) => {
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

export async function listSales(): Promise<Sale[]> {
  const rows = await prisma.sale.findMany({
    include: { items: true },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map(toSale);
}

export async function getSale(id: string): Promise<Sale | null> {
  const row = await prisma.sale.findUnique({ where: { id }, include: { items: true } });
  return row ? toSale(row) : null;
}
