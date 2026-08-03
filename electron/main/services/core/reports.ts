import { getSession } from './auth';
import { prisma } from './database';
import type { ReportRange, SalesSummary, TopProduct } from '@shared/ipc';

// ALL_TIME's lower bound is the Unix epoch, not a null/undefined case — every
// real Sale row's createdAt is necessarily after this, so a plain `gte: from`
// comparison works uniformly for every range in the query functions below,
// with no special-case branch needed there.
export function resolveRange(range: ReportRange, now: Date = new Date()): { from: Date; to: Date } {
  const to = now;

  if (range === 'ALL_TIME') {
    return { from: new Date(0), to };
  }

  if (range === 'TODAY') {
    return { from: new Date(now.getFullYear(), now.getMonth(), now.getDate()), to };
  }

  if (range === 'THIS_WEEK') {
    const daysSinceMonday = (now.getDay() + 6) % 7;
    return {
      from: new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysSinceMonday),
      to,
    };
  }

  // THIS_MONTH
  return { from: new Date(now.getFullYear(), now.getMonth(), 1), to };
}

const NOT_AUTHORIZED_MESSAGE = 'Reports are limited to managers and administrators';

function requireManagerOrAdmin(): void {
  const role = getSession()?.role;
  if (role !== 'ADMIN' && role !== 'MANAGER') {
    throw new Error(NOT_AUTHORIZED_MESSAGE);
  }
}

export async function getSalesSummary(range: ReportRange): Promise<SalesSummary> {
  requireManagerOrAdmin();
  const { from, to } = resolveRange(range);
  const where = { createdAt: { gte: from, lte: to } };

  const [totals, cashTotals] = await Promise.all([
    prisma.sale.aggregate({ where, _sum: { total: true }, _count: { _all: true } }),
    prisma.sale.aggregate({
      where: { ...where, paymentMethod: 'CASH' as const },
      _sum: { total: true },
    }),
  ]);

  const totalRevenue = totals._sum.total ?? 0;
  const transactionCount = totals._count._all;
  const cashTotal = cashTotals._sum.total ?? 0;

  return {
    totalRevenue,
    transactionCount,
    averageSale: transactionCount === 0 ? 0 : Math.round(totalRevenue / transactionCount),
    cashTotal,
    mobileMoneyTotal: totalRevenue - cashTotal,
  };
}

// quantity * unitPrice can't be expressed as a plain Prisma groupBy sum
// without raw SQL — SaleItem rows are fetched pre-filtered to the date
// range instead and reduced here, which is simpler and just as correct as
// raw SQL for a single shop's realistic sale volume.
export async function getTopProducts(range: ReportRange, limit = 5): Promise<TopProduct[]> {
  requireManagerOrAdmin();
  const { from, to } = resolveRange(range);

  const items = await prisma.saleItem.findMany({
    where: { sale: { createdAt: { gte: from, lte: to } } },
    select: { productName: true, quantity: true, unitPrice: true },
  });

  const totals = new Map<string, { quantitySold: number; revenue: number }>();
  for (const item of items) {
    const existing = totals.get(item.productName) ?? { quantitySold: 0, revenue: 0 };
    existing.quantitySold += item.quantity;
    existing.revenue += item.quantity * item.unitPrice;
    totals.set(item.productName, existing);
  }

  return Array.from(totals.entries())
    .map(([productName, { quantitySold, revenue }]) => ({ productName, quantitySold, revenue }))
    .sort((a, b) => b.revenue - a.revenue || b.quantitySold - a.quantitySold)
    .slice(0, limit);
}
