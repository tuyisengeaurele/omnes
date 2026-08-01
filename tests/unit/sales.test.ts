// @vitest-environment node
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { afterAll, describe, expect, it } from 'vitest';
import { login } from '../../electron/main/services/core/auth';
import { createProduct, listProducts } from '../../electron/main/services/core/products';
import { createSale, getSale, listSales } from '../../electron/main/services/core/sales';
import { prisma } from '../../electron/main/services/core/database';

function uniqueSku(): string {
  return `TEST-${randomUUID()}`;
}

describe('sales', () => {
  const createdSaleIds: string[] = [];
  const createdProductIds: string[] = [];

  afterAll(async () => {
    await prisma.sale.deleteMany({ where: { id: { in: createdSaleIds } } });
    await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
    await prisma.$disconnect();
  });

  async function makeTestProduct(stockQuantity: number, price = 100): Promise<string> {
    const result = await createProduct({
      name: 'Test Sale Product',
      sku: uniqueSku(),
      barcode: null,
      category: 'Widgets',
      price,
      stockQuantity,
    });
    const id = result.product?.id as string;
    createdProductIds.push(id);
    return id;
  }

  it('completes a cash sale and deducts stock', async () => {
    const productId = await makeTestProduct(10, 500);

    const result = await createSale({
      items: [{ productId, quantity: 3 }],
      paymentMethod: 'CASH',
      amountTendered: 2000,
    });

    expect(result.success).toBe(true);
    expect(result.sale?.total).toBe(1500);
    expect(result.sale?.changeGiven).toBe(500);
    if (result.sale) createdSaleIds.push(result.sale.id);

    const products = await listProducts(true);
    expect(products.find((product) => product.id === productId)?.stockQuantity).toBe(7);
  });

  it('rejects a sale when stock is insufficient, leaving stock unchanged', async () => {
    const productId = await makeTestProduct(2);

    const result = await createSale({
      items: [{ productId, quantity: 5 }],
      paymentMethod: 'CASH',
      amountTendered: 1000,
    });

    expect(result.success).toBe(false);
    expect(result.sale).toBeNull();

    const products = await listProducts(true);
    expect(products.find((product) => product.id === productId)?.stockQuantity).toBe(2);
  });

  it('rejects a cash sale with insufficient amount tendered', async () => {
    const productId = await makeTestProduct(10, 1000);

    const result = await createSale({
      items: [{ productId, quantity: 1 }],
      paymentMethod: 'CASH',
      amountTendered: 500,
    });

    expect(result.success).toBe(false);
    expect(result.message).toBe('Amount tendered is less than the total');
  });

  it('records a mobile money sale without amount tendered or change', async () => {
    const productId = await makeTestProduct(5, 1000);

    const result = await createSale({
      items: [{ productId, quantity: 1 }],
      paymentMethod: 'MOBILE_MONEY',
      amountTendered: null,
    });

    expect(result.success).toBe(true);
    expect(result.sale?.amountTendered).toBeNull();
    expect(result.sale?.changeGiven).toBeNull();
    if (result.sale) createdSaleIds.push(result.sale.id);
  });

  it('does not oversell when two checkouts race for the last unit', async () => {
    const productId = await makeTestProduct(1, 100);

    const [first, second] = await Promise.all([
      createSale({
        items: [{ productId, quantity: 1 }],
        paymentMethod: 'CASH',
        amountTendered: 100,
      }),
      createSale({
        items: [{ productId, quantity: 1 }],
        paymentMethod: 'CASH',
        amountTendered: 100,
      }),
    ]);

    const successes = [first, second].filter((result) => result.success);
    expect(successes).toHaveLength(1);
    for (const result of successes) {
      if (result.sale) createdSaleIds.push(result.sale.id);
    }

    const products = await listProducts(true);
    expect(products.find((product) => product.id === productId)?.stockQuantity).toBe(0);
  }, 15_000);

  it('degrades to an unattributed sale when the session user no longer exists', async () => {
    // Simulates a restore reverting the database to a point before this
    // cashier's account existed while their session is still live — the
    // real failure this e2e-discovered bug reproduced.
    const username = `test-cashier-${randomUUID()}`;
    const passwordHash = await bcrypt.hash('test-password-123', 12);
    const user = await prisma.user.create({
      data: { username, passwordHash, role: 'CASHIER' },
    });

    await login(username, 'test-password-123');
    await prisma.user.delete({ where: { id: user.id } });

    const productId = await makeTestProduct(5, 500);
    const result = await createSale({
      items: [{ productId, quantity: 1 }],
      paymentMethod: 'CASH',
      amountTendered: 500,
    });

    expect(result.success).toBe(true);
    expect(result.sale?.cashierUsername).toBe(username);
    if (result.sale) createdSaleIds.push(result.sale.id);

    // Deliberately not calling logout() here: auth.ts's logout() has the
    // same class of bug this test exists to prove sales.ts doesn't have
    // (it writes an AuditLog row trusting currentSession.userId without
    // verifying the row still exists) — out of scope for this file, flagged
    // separately. Leaving the session as-is for the rest of this suite is
    // harmless; no other test here depends on getSession() being cleared.
  });

  it('lists and retrieves a sale', async () => {
    const productId = await makeTestProduct(5, 250);
    const created = await createSale({
      items: [{ productId, quantity: 2 }],
      paymentMethod: 'CASH',
      amountTendered: 1000,
    });
    const saleId = created.sale?.id as string;
    createdSaleIds.push(saleId);

    const sales = await listSales();
    expect(sales.some((sale) => sale.id === saleId)).toBe(true);

    const fetched = await getSale(saleId);
    expect(fetched?.items).toHaveLength(1);
    expect(fetched?.items[0]?.productName).toBe('Test Sale Product');
  });
});
