// @vitest-environment node
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createFirstAdmin, login } from '../../electron/main/services/core/auth';
import {
  getSalesSummary,
  getTopProducts,
  resolveRange,
} from '../../electron/main/services/core/reports';
import { prisma } from '../../electron/main/services/core/database';
import type { PaymentMethod } from '@shared/ipc';

// 2024-01-17 is a Wednesday; its Monday (2024-01-15) and the 1st of that
// month (2024-01-01) are both distinct from it and from each other, so
// TODAY/THIS_WEEK/THIS_MONTH each produce a genuinely different boundary
// worth asserting separately.
describe('resolveRange', () => {
  const now = new Date(2024, 0, 17, 14, 30, 0);

  it('TODAY starts at local midnight of the given day', () => {
    const { from, to } = resolveRange('TODAY', now);
    expect(from).toEqual(new Date(2024, 0, 17, 0, 0, 0));
    expect(to).toEqual(now);
  });

  it('THIS_WEEK starts on the most recent Monday', () => {
    const { from } = resolveRange('THIS_WEEK', now);
    expect(from).toEqual(new Date(2024, 0, 15, 0, 0, 0));
  });

  it('THIS_WEEK on a Monday starts on itself', () => {
    const monday = new Date(2024, 0, 15, 9, 0, 0);
    const { from } = resolveRange('THIS_WEEK', monday);
    expect(from).toEqual(new Date(2024, 0, 15, 0, 0, 0));
  });

  it("THIS_WEEK on a Sunday starts on the current week's Monday", () => {
    const sunday = new Date(2024, 0, 21, 9, 0, 0);
    const { from } = resolveRange('THIS_WEEK', sunday);
    expect(from).toEqual(new Date(2024, 0, 15, 0, 0, 0));
  });

  it('THIS_MONTH starts on the 1st', () => {
    const { from } = resolveRange('THIS_MONTH', now);
    expect(from).toEqual(new Date(2024, 0, 1, 0, 0, 0));
  });

  it('ALL_TIME has no meaningful lower bound', () => {
    const { from } = resolveRange('ALL_TIME', now);
    expect(from).toEqual(new Date(0));
  });
});

describe('getSalesSummary and getTopProducts', () => {
  beforeEach(async () => {
    await prisma.saleItem.deleteMany();
    await prisma.sale.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await prisma.saleItem.deleteMany();
    await prisma.sale.deleteMany();
    await prisma.user.deleteMany();
    await prisma.$disconnect();
  });

  async function bootstrapAdmin(): Promise<void> {
    await createFirstAdmin(`admin-${randomUUID()}`, 'admin-password-123');
  }

  async function createTestSale(
    total: number,
    paymentMethod: PaymentMethod,
    createdAt: Date,
    items: { productName: string; quantity: number; unitPrice: number }[],
  ): Promise<void> {
    await prisma.sale.create({
      data: { total, paymentMethod, createdAt, items: { create: items } },
    });
  }

  it('rejects a cashier session', async () => {
    const username = `cashier-${randomUUID()}`;
    const passwordHash = await bcrypt.hash('cashier-password-123', 12);
    await prisma.user.create({ data: { username, passwordHash, role: 'CASHIER' } });
    await login(username, 'cashier-password-123');

    await expect(getSalesSummary('ALL_TIME')).rejects.toThrow(
      'Reports are limited to managers and administrators',
    );
    await expect(getTopProducts('ALL_TIME')).rejects.toThrow(
      'Reports are limited to managers and administrators',
    );
  });

  it('allows a manager session', async () => {
    const username = `manager-${randomUUID()}`;
    const passwordHash = await bcrypt.hash('manager-password-123', 12);
    await prisma.user.create({ data: { username, passwordHash, role: 'MANAGER' } });
    await login(username, 'manager-password-123');

    await expect(getSalesSummary('ALL_TIME')).resolves.toBeDefined();
  });

  it('summarizes sales within a date range, excluding sales outside it', async () => {
    await bootstrapAdmin();
    const now = new Date();
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 15);

    await createTestSale(1000, 'CASH', now, [
      { productName: 'Widget', quantity: 2, unitPrice: 500 },
    ]);
    await createTestSale(500, 'MOBILE_MONEY', now, [
      { productName: 'Widget', quantity: 1, unitPrice: 500 },
    ]);
    await createTestSale(9999, 'CASH', lastMonth, [
      { productName: 'Widget', quantity: 1, unitPrice: 9999 },
    ]);

    const summary = await getSalesSummary('THIS_MONTH');
    expect(summary.transactionCount).toBe(2);
    expect(summary.totalRevenue).toBe(1500);
    expect(summary.cashTotal).toBe(1000);
    expect(summary.mobileMoneyTotal).toBe(500);
    expect(summary.averageSale).toBe(750);
  });

  it('returns a zeroed summary with no division-by-zero for an empty range', async () => {
    await bootstrapAdmin();

    const summary = await getSalesSummary('THIS_MONTH');
    expect(summary.transactionCount).toBe(0);
    expect(summary.totalRevenue).toBe(0);
    expect(summary.averageSale).toBe(0);
  });

  it('ranks top products by revenue, capped at the given limit', async () => {
    await bootstrapAdmin();
    const now = new Date();

    await createTestSale(3000, 'CASH', now, [
      { productName: 'Gadget', quantity: 1, unitPrice: 3000 },
    ]);
    await createTestSale(1000, 'CASH', now, [
      { productName: 'Widget', quantity: 10, unitPrice: 100 },
    ]);
    await createTestSale(200, 'CASH', now, [{ productName: 'Gizmo', quantity: 2, unitPrice: 100 }]);

    const top = await getTopProducts('TODAY', 2);
    expect(top).toHaveLength(2);
    expect(top[0]).toEqual({ productName: 'Gadget', quantitySold: 1, revenue: 3000 });
    expect(top[1]).toEqual({ productName: 'Widget', quantitySold: 10, revenue: 1000 });
  });

  it('returns an empty array for a range with no sales', async () => {
    await bootstrapAdmin();
    expect(await getTopProducts('THIS_MONTH')).toEqual([]);
  });
});
