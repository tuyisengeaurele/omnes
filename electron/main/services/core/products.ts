import { Prisma } from '../../../../generated/prisma/client';
import { prisma } from './database';
import type { Product, ProductInput, ProductResult } from '@shared/ipc';

interface ProductRow {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  category: string;
  price: number;
  stockQuantity: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

function toProduct(row: ProductRow): Product {
  return {
    id: row.id,
    name: row.name,
    sku: row.sku,
    barcode: row.barcode,
    category: row.category,
    price: row.price,
    stockQuantity: row.stockQuantity,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function validateInput(input: Partial<ProductInput>): void {
  if (input.name !== undefined && input.name.trim().length === 0) {
    throw new Error('Product name is required');
  }
  if (input.sku !== undefined && input.sku.trim().length === 0) {
    throw new Error('SKU is required');
  }
  if (input.price !== undefined && input.price < 0) {
    throw new Error('Price cannot be negative');
  }
  if (input.stockQuantity !== undefined && input.stockQuantity < 0) {
    throw new Error('Stock quantity cannot be negative');
  }
}

interface DriverAdapterConstraintMeta {
  driverAdapterError?: {
    cause?: {
      constraint?: {
        fields?: string[];
      };
    };
  };
  target?: string[];
}

function getConflictingFields(error: Prisma.PrismaClientKnownRequestError): string[] {
  const meta = error.meta as DriverAdapterConstraintMeta | undefined;
  // @prisma/adapter-pg wraps the underlying pg error rather than populating
  // the classic `meta.target` shape — the conflicting column names live
  // under `meta.driverAdapterError.cause.constraint.fields` instead.
  return meta?.driverAdapterError?.cause?.constraint?.fields ?? meta?.target ?? [];
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    const fields = getConflictingFields(error);
    if (fields.includes('sku')) {
      return 'SKU already in use';
    }
    if (fields.includes('barcode')) {
      return 'Barcode already in use';
    }
  }
  return error instanceof Error ? error.message : String(error);
}

export async function listProducts(includeInactive = false): Promise<Product[]> {
  const rows = await prisma.product.findMany({
    where: includeInactive ? undefined : { isActive: true },
    orderBy: { name: 'asc' },
  });
  return rows.map(toProduct);
}

export async function createProduct(input: ProductInput): Promise<ProductResult> {
  try {
    validateInput(input);
    const row = await prisma.product.create({
      data: {
        name: input.name.trim(),
        sku: input.sku.trim(),
        barcode: input.barcode?.trim() || null,
        category: input.category.trim(),
        price: input.price,
        stockQuantity: input.stockQuantity,
      },
    });
    return { success: true, message: 'Product created', product: toProduct(row) };
  } catch (error) {
    return { success: false, message: toErrorMessage(error), product: null };
  }
}

export async function updateProduct(
  id: string,
  input: Partial<ProductInput>,
): Promise<ProductResult> {
  try {
    validateInput(input);
    const row = await prisma.product.update({
      where: { id },
      data: {
        ...(input.name !== undefined && { name: input.name.trim() }),
        ...(input.sku !== undefined && { sku: input.sku.trim() }),
        ...(input.barcode !== undefined && { barcode: input.barcode?.trim() || null }),
        ...(input.category !== undefined && { category: input.category.trim() }),
        ...(input.price !== undefined && { price: input.price }),
        ...(input.stockQuantity !== undefined && { stockQuantity: input.stockQuantity }),
      },
    });
    return { success: true, message: 'Product updated', product: toProduct(row) };
  } catch (error) {
    return { success: false, message: toErrorMessage(error), product: null };
  }
}

export async function setProductActive(id: string, isActive: boolean): Promise<ProductResult> {
  try {
    const row = await prisma.product.update({
      where: { id },
      data: { isActive },
    });
    return {
      success: true,
      message: isActive ? 'Product reactivated' : 'Product deactivated',
      product: toProduct(row),
    };
  } catch (error) {
    return { success: false, message: toErrorMessage(error), product: null };
  }
}
