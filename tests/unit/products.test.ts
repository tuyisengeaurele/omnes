// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import {
  createProduct,
  listProducts,
  setProductActive,
  updateProduct,
} from '../../electron/main/services/core/products';
import { prisma } from '../../electron/main/services/core/database';

function uniqueSku(): string {
  return `TEST-${randomUUID()}`;
}

describe('products', () => {
  afterAll(async () => {
    await prisma.product.deleteMany({ where: { sku: { startsWith: 'TEST-' } } });
    await prisma.$disconnect();
  });

  it('creates and lists a product', async () => {
    const sku = uniqueSku();
    const result = await createProduct({
      name: 'Test Widget',
      sku,
      barcode: null,
      category: 'Widgets',
      price: 1500,
      stockQuantity: 10,
    });

    expect(result.success).toBe(true);
    expect(result.product?.sku).toBe(sku);

    const products = await listProducts();
    expect(products.some((product) => product.sku === sku)).toBe(true);
  });

  it('rejects a duplicate SKU', async () => {
    const sku = uniqueSku();
    await createProduct({
      name: 'First',
      sku,
      barcode: null,
      category: 'Widgets',
      price: 100,
      stockQuantity: 1,
    });

    const result = await createProduct({
      name: 'Second',
      sku,
      barcode: null,
      category: 'Widgets',
      price: 200,
      stockQuantity: 2,
    });

    expect(result.success).toBe(false);
    expect(result.message).toBe('SKU already in use');
  });

  it('rejects a duplicate barcode', async () => {
    const barcode = uniqueSku();
    await createProduct({
      name: 'First',
      sku: uniqueSku(),
      barcode,
      category: 'Widgets',
      price: 100,
      stockQuantity: 1,
    });

    const result = await createProduct({
      name: 'Second',
      sku: uniqueSku(),
      barcode,
      category: 'Widgets',
      price: 200,
      stockQuantity: 2,
    });

    expect(result.success).toBe(false);
    expect(result.message).toBe('Barcode already in use');
  });

  it('rejects a negative price', async () => {
    const result = await createProduct({
      name: 'Bad Widget',
      sku: uniqueSku(),
      barcode: null,
      category: 'Widgets',
      price: -100,
      stockQuantity: 1,
    });

    expect(result.success).toBe(false);
    expect(result.message).toBe('Price cannot be negative');
  });

  it('updates a product', async () => {
    const created = await createProduct({
      name: 'Before',
      sku: uniqueSku(),
      barcode: null,
      category: 'Widgets',
      price: 100,
      stockQuantity: 1,
    });
    const id = created.product?.id as string;

    const updated = await updateProduct(id, { name: 'After', price: 200 });

    expect(updated.success).toBe(true);
    expect(updated.product?.name).toBe('After');
    expect(updated.product?.price).toBe(200);
  });

  it('deactivates and reactivates a product without deleting it', async () => {
    const created = await createProduct({
      name: 'Togglable',
      sku: uniqueSku(),
      barcode: null,
      category: 'Widgets',
      price: 100,
      stockQuantity: 1,
    });
    const id = created.product?.id as string;

    const deactivated = await setProductActive(id, false);
    expect(deactivated.success).toBe(true);
    expect(deactivated.product?.isActive).toBe(false);

    const activeList = await listProducts();
    expect(activeList.some((product) => product.id === id)).toBe(false);

    const fullList = await listProducts(true);
    expect(fullList.some((product) => product.id === id)).toBe(true);

    const reactivated = await setProductActive(id, true);
    expect(reactivated.success).toBe(true);
    expect(reactivated.product?.isActive).toBe(true);
  });
});
