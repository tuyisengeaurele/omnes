/**
 * Catalog persistence: merchants, categories, products. Prisma stores
 * latitude/longitude as Decimal columns, which come back from the client as
 * decimal.js objects, not plain numbers - every function here converts them
 * to numbers before returning, so nothing above this file needs to know
 * Prisma's Decimal type exists.
 */

import { getDb } from '../../platform/db.js';
import type { BoundingBox } from '../../adapters/geo/index.js';
import type { Vertical } from '@omnes/contracts';

export interface MerchantRow {
  id: string;
  name: string;
  vertical: string;
  cityId: string;
  zoneId: string;
  latitude: number;
  longitude: number;
  rating: number;
  prepTimeMinutes: number;
  isOpen: boolean;
  status: string;
  createdAt: Date;
}

const MERCHANT_SELECT = {
  id: true,
  name: true,
  vertical: true,
  cityId: true,
  zoneId: true,
  latitude: true,
  longitude: true,
  rating: true,
  prepTimeMinutes: true,
  isOpen: true,
  status: true,
  createdAt: true,
} as const;

interface RawMerchant {
  id: string;
  name: string;
  vertical: string;
  cityId: string;
  zoneId: string;
  latitude: { toNumber(): number };
  longitude: { toNumber(): number };
  rating: { toNumber(): number };
  prepTimeMinutes: number;
  isOpen: boolean;
  status: string;
  createdAt: Date;
}

function toMerchantRow(row: RawMerchant): MerchantRow {
  return {
    id: row.id,
    name: row.name,
    vertical: row.vertical,
    cityId: row.cityId,
    zoneId: row.zoneId,
    latitude: row.latitude.toNumber(),
    longitude: row.longitude.toNumber(),
    rating: row.rating.toNumber(),
    prepTimeMinutes: row.prepTimeMinutes,
    isOpen: row.isOpen,
    status: row.status,
    createdAt: row.createdAt,
  };
}

export type MerchantOrderBy = 'rating' | 'eta' | 'recent';

export interface ListMerchantsPage {
  cityId: string;
  vertical?: Vertical;
  minRating?: number;
  sortBy?: MerchantOrderBy;
  cursor?: string;
  limit: number;
}

/**
 * Same query, ordered differently. id is always the tiebreak, both to keep
 * the order stable when two merchants tie on the primary key and because
 * Prisma's cursor pagination resolves the cursor row by id and continues
 * from its position in exactly this sequence - the tiebreak has to be
 * present and consistent for that to paginate correctly.
 */
const MERCHANT_ORDER_BY = {
  rating: [{ rating: 'desc' }, { id: 'desc' }],
  eta: [{ prepTimeMinutes: 'asc' }, { id: 'desc' }],
  recent: [{ createdAt: 'desc' }, { id: 'desc' }],
} as const;

/**
 * Standard, non-geo listing: DB-level cursor pagination, ordered by
 * whichever of rating, ETA (prepTimeMinutes), or recency was requested.
 */
export async function findMerchantsPage(params: ListMerchantsPage): Promise<{
  items: MerchantRow[];
  nextCursor: string | null;
}> {
  const where = {
    cityId: params.cityId,
    status: 'ACTIVE' as const,
    ...(params.vertical ? { vertical: params.vertical } : {}),
    ...(params.minRating !== undefined ? { rating: { gte: params.minRating } } : {}),
  };

  const rows = await getDb().merchant.findMany({
    where,
    select: MERCHANT_SELECT,
    orderBy: [...MERCHANT_ORDER_BY[params.sortBy ?? 'recent']],
    take: params.limit + 1,
    ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
  });

  const hasMore = rows.length > params.limit;
  const page = hasMore ? rows.slice(0, params.limit) : rows;
  const last = page[page.length - 1];

  return {
    items: page.map(toMerchantRow),
    nextCursor: hasMore && last ? last.id : null,
  };
}

/**
 * Candidates for a geo-filtered listing: every ACTIVE merchant in the city
 * (and vertical, if given) whose indexed lat/lng falls inside the bounding
 * box. This is the cheap prefilter; the caller computes exact distance and
 * sorts afterward. Capped at maxCandidates so an enormous city cannot pull
 * an unbounded row set into memory - see docs/build-plan.md section 1.6.
 */
export async function findMerchantsInBox(params: {
  cityId: string;
  vertical?: Vertical;
  minRating?: number;
  box: BoundingBox;
  maxCandidates: number;
}): Promise<MerchantRow[]> {
  const rows = await getDb().merchant.findMany({
    where: {
      cityId: params.cityId,
      status: 'ACTIVE',
      ...(params.vertical ? { vertical: params.vertical } : {}),
      ...(params.minRating !== undefined ? { rating: { gte: params.minRating } } : {}),
      latitude: { gte: params.box.minLatitude, lte: params.box.maxLatitude },
      longitude: { gte: params.box.minLongitude, lte: params.box.maxLongitude },
    },
    select: MERCHANT_SELECT,
    take: params.maxCandidates,
  });

  return rows.map(toMerchantRow);
}

export async function findMerchantById(id: string): Promise<MerchantRow | null> {
  const row = await getDb().merchant.findUnique({ where: { id }, select: MERCHANT_SELECT });
  return row ? toMerchantRow(row) : null;
}

export interface ProductRow {
  id: string;
  merchantId: string;
  categoryId: string | null;
  name: string;
  description: string | null;
  priceMinor: bigint;
  currency: string;
  imageKey: string | null;
  isAvailable: boolean;
  stockCount: number | null;
}

export interface CategoryWithProductRows {
  id: string;
  name: string;
  sortOrder: number;
  products: ProductRow[];
}

/**
 * Merchant plus its full menu in one round trip: categories, each with its
 * products, via a deliberate nested `include` rather than N+1 separate
 * queries per category.
 */
export async function findMerchantMenu(merchantId: string): Promise<{
  merchant: MerchantRow;
  categories: CategoryWithProductRows[];
} | null> {
  const merchant = await getDb().merchant.findUnique({
    where: { id: merchantId },
    select: {
      ...MERCHANT_SELECT,
      categories: {
        orderBy: { sortOrder: 'asc' },
        select: {
          id: true,
          name: true,
          sortOrder: true,
          products: {
            where: { isAvailable: true },
            select: {
              id: true,
              merchantId: true,
              categoryId: true,
              name: true,
              description: true,
              priceMinor: true,
              currency: true,
              imageKey: true,
              isAvailable: true,
              stockCount: true,
            },
          },
        },
      },
    },
  });

  if (!merchant) return null;

  const { categories, ...rest } = merchant;
  return {
    merchant: toMerchantRow(rest),
    categories,
  };
}

export interface SearchRow {
  merchants: MerchantRow[];
  products: Array<ProductRow & { merchantName: string }>;
}

/**
 * Autocomplete-style search: merchants and products whose name contains the
 * query, case-insensitively, within one city. Two queries rather than one
 * SQL UNION, since the two result shapes differ and Prisma's query builder
 * does not support a heterogeneous union cleanly - each is independently
 * indexed and limited, so this stays cheap.
 */
export async function searchCatalog(params: {
  cityId: string;
  query: string;
  limit: number;
}): Promise<SearchRow> {
  const [merchantRows, productRows] = await Promise.all([
    getDb().merchant.findMany({
      where: {
        cityId: params.cityId,
        status: 'ACTIVE',
        name: { contains: params.query, mode: 'insensitive' },
      },
      select: MERCHANT_SELECT,
      take: params.limit,
    }),
    getDb().product.findMany({
      where: {
        isAvailable: true,
        name: { contains: params.query, mode: 'insensitive' },
        merchant: { cityId: params.cityId, status: 'ACTIVE' },
      },
      select: {
        id: true,
        merchantId: true,
        categoryId: true,
        name: true,
        description: true,
        priceMinor: true,
        currency: true,
        imageKey: true,
        isAvailable: true,
        stockCount: true,
        merchant: { select: { name: true } },
      },
      take: params.limit,
    }),
  ]);

  return {
    merchants: merchantRows.map(toMerchantRow),
    products: productRows.map(({ merchant, ...p }) => ({ ...p, merchantName: merchant.name })),
  };
}

export async function createMerchant(input: {
  name: string;
  vertical: Vertical;
  cityId: string;
  zoneId: string;
  latitude: number;
  longitude: number;
  prepTimeMinutes: number;
}): Promise<MerchantRow> {
  const row = await getDb().merchant.create({
    data: {
      name: input.name,
      vertical: input.vertical,
      cityId: input.cityId,
      zoneId: input.zoneId,
      latitude: input.latitude,
      longitude: input.longitude,
      prepTimeMinutes: input.prepTimeMinutes,
      status: 'ACTIVE',
      isOpen: true,
    },
    select: MERCHANT_SELECT,
  });
  return toMerchantRow(row);
}

export async function updateMerchant(
  id: string,
  input: { name?: string; isOpen?: boolean; prepTimeMinutes?: number }
): Promise<MerchantRow> {
  const row = await getDb().merchant.update({
    where: { id },
    data: input,
    select: MERCHANT_SELECT,
  });
  return toMerchantRow(row);
}

export async function createCategory(
  merchantId: string,
  input: { name: string; sortOrder: number }
): Promise<{ id: string; name: string; sortOrder: number }> {
  return getDb().category.create({
    data: { merchantId, name: input.name, sortOrder: input.sortOrder },
    select: { id: true, name: true, sortOrder: true },
  });
}

export async function findCategoryOwner(categoryId: string): Promise<string | null> {
  const row = await getDb().category.findUnique({
    where: { id: categoryId },
    select: { merchantId: true },
  });
  return row?.merchantId ?? null;
}

export async function updateCategory(
  id: string,
  input: { name?: string; sortOrder?: number }
): Promise<{ id: string; name: string; sortOrder: number }> {
  return getDb().category.update({
    where: { id },
    data: input,
    select: { id: true, name: true, sortOrder: true },
  });
}

export async function deleteCategory(id: string): Promise<void> {
  await getDb().category.delete({ where: { id } });
}

export async function createProduct(
  merchantId: string,
  input: {
    categoryId?: string;
    name: string;
    description?: string;
    priceMinor: bigint;
    currency: string;
    isAvailable: boolean;
    stockCount?: number;
  }
): Promise<ProductRow> {
  return getDb().product.create({
    data: {
      merchantId,
      categoryId: input.categoryId ?? null,
      name: input.name,
      description: input.description ?? null,
      priceMinor: input.priceMinor,
      currency: input.currency,
      isAvailable: input.isAvailable,
      stockCount: input.stockCount ?? null,
    },
    select: {
      id: true,
      merchantId: true,
      categoryId: true,
      name: true,
      description: true,
      priceMinor: true,
      currency: true,
      imageKey: true,
      isAvailable: true,
      stockCount: true,
    },
  });
}

export async function findProductOwner(productId: string): Promise<string | null> {
  const row = await getDb().product.findUnique({
    where: { id: productId },
    select: { merchantId: true },
  });
  return row?.merchantId ?? null;
}

/**
 * The current price, availability, and stock for one product. This is what
 * the order module calls to revalidate a cart line against - the cart
 * never trusts a client-supplied price or a stale snapshot from when the
 * item was added.
 */
export async function findProductById(productId: string): Promise<ProductRow | null> {
  return getDb().product.findUnique({
    where: { id: productId },
    select: {
      id: true,
      merchantId: true,
      categoryId: true,
      name: true,
      description: true,
      priceMinor: true,
      currency: true,
      imageKey: true,
      isAvailable: true,
      stockCount: true,
    },
  });
}

export async function updateProduct(
  id: string,
  input: {
    categoryId?: string | null;
    name?: string;
    description?: string | null;
    priceMinor?: bigint;
    isAvailable?: boolean;
    stockCount?: number | null;
  }
): Promise<ProductRow> {
  return getDb().product.update({
    where: { id },
    data: input,
    select: {
      id: true,
      merchantId: true,
      categoryId: true,
      name: true,
      description: true,
      priceMinor: true,
      currency: true,
      imageKey: true,
      isAvailable: true,
      stockCount: true,
    },
  });
}

export async function deleteProduct(id: string): Promise<void> {
  await getDb().product.delete({ where: { id } });
}
