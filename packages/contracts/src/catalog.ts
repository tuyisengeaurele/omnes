/**
 * Catalog request schemas and shared response types. Request shapes are
 * validated with Zod on the server; response shapes are plain TypeScript
 * types rather than schemas, since a service validates its own outgoing
 * data by construction and does not need to re-check what it just built -
 * validation earns its cost at a boundary where the data could be wrong,
 * which is the request side, not here.
 */

import { z } from 'zod';
import { verticalSchema } from './enums.js';
import { paginationQuerySchema, type Money } from './primitives.js';

// ---------------------------------------------------------------------------
// Merchant list and search
// ---------------------------------------------------------------------------

/**
 * 'distance' only means anything with a near point given; the service falls
 * back to 'recent' when it is requested without one. 'eta' sorts by
 * prepTimeMinutes ascending - the merchant's own estimate, not a live
 * traffic-aware delivery ETA, which needs a real routing engine this MVP
 * does not have.
 */
export const merchantSortSchema = z.enum(['distance', 'rating', 'eta', 'recent']);
export type MerchantSort = z.infer<typeof merchantSortSchema>;

export const listMerchantsQuerySchema = paginationQuerySchema
  .extend({
    cityId: z.string().uuid(),
    vertical: verticalSchema.optional(),
    latitude: z.coerce.number().min(-90).max(90).optional(),
    longitude: z.coerce.number().min(-180).max(180).optional(),
    radiusM: z.coerce.number().positive().max(50_000).optional(),
    minRating: z.coerce.number().min(0).max(5).optional(),
    sortBy: merchantSortSchema.optional(),
  })
  .refine((data) => (data.latitude === undefined) === (data.longitude === undefined), {
    message: 'latitude and longitude must be provided together',
    path: ['longitude'],
  });
export type ListMerchantsQuery = z.infer<typeof listMerchantsQuerySchema>;

export const searchCatalogQuerySchema = paginationQuerySchema.extend({
  cityId: z.string().uuid(),
  q: z.string().trim().min(1, 'search query is required').max(100),
});
export type SearchCatalogQuery = z.infer<typeof searchCatalogQuerySchema>;

// ---------------------------------------------------------------------------
// Merchant CRUD
// ---------------------------------------------------------------------------

export const createMerchantSchema = z.object({
  name: z.string().trim().min(1, 'name is required').max(200),
  vertical: verticalSchema,
  cityId: z.string().uuid(),
  zoneId: z.string().uuid(),
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  ownerUserId: z.string().uuid(),
  prepTimeMinutes: z.coerce.number().int().positive().max(180).default(15),
});
export type CreateMerchantInput = z.infer<typeof createMerchantSchema>;

export const updateMerchantSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    isOpen: z.boolean().optional(),
    prepTimeMinutes: z.coerce.number().int().positive().max(180).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: 'at least one field is required' });
export type UpdateMerchantInput = z.infer<typeof updateMerchantSchema>;

// ---------------------------------------------------------------------------
// Category CRUD
// ---------------------------------------------------------------------------

export const createCategorySchema = z.object({
  name: z.string().trim().min(1, 'name is required').max(120),
  sortOrder: z.coerce.number().int().min(0).default(0),
});
export type CreateCategoryInput = z.infer<typeof createCategorySchema>;

export const updateCategorySchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    sortOrder: z.coerce.number().int().min(0).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: 'at least one field is required' });
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;

// ---------------------------------------------------------------------------
// Product CRUD
// ---------------------------------------------------------------------------

const priceMinorSchema = z.string().regex(/^\d+$/, 'must be a non-negative integer string');

export const createProductSchema = z.object({
  categoryId: z.string().uuid().optional(),
  name: z.string().trim().min(1, 'name is required').max(200),
  description: z.string().trim().max(2000).optional(),
  priceMinor: priceMinorSchema,
  currency: z.string().length(3).toUpperCase(),
  isAvailable: z.boolean().default(true),
  stockCount: z.coerce.number().int().min(0).optional(),
});
export type CreateProductInput = z.infer<typeof createProductSchema>;

export const updateProductSchema = z
  .object({
    categoryId: z.string().uuid().nullable().optional(),
    name: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    priceMinor: priceMinorSchema.optional(),
    isAvailable: z.boolean().optional(),
    stockCount: z.coerce.number().int().min(0).nullable().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: 'at least one field is required' });
export type UpdateProductInput = z.infer<typeof updateProductSchema>;

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

export interface MerchantSummary {
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
  /** Present only when the list was queried with a near point. */
  distanceMeters?: number;
}

export interface ProductSummary {
  id: string;
  categoryId: string | null;
  name: string;
  description: string | null;
  price: Money;
  imageKey: string | null;
  isAvailable: boolean;
  stockCount: number | null;
}

export interface CategoryWithProducts {
  id: string;
  name: string;
  sortOrder: number;
  products: ProductSummary[];
}

export interface MerchantDetail extends MerchantSummary {
  categories: CategoryWithProducts[];
}

export interface SearchResults {
  merchants: MerchantSummary[];
  products: Array<ProductSummary & { merchantId: string; merchantName: string }>;
}
