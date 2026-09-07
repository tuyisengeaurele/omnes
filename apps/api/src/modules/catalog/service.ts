/**
 * Catalog business logic: merchant listing (with the geo-sort branch),
 * search, menu assembly, and the CRUD operations behind RBAC. Combines the
 * repository with a GeoPort so the distance math and pagination-mode
 * decision live in one place rather than being reimplemented per route.
 */

import type { Vertical } from '@omnes/contracts';
import type { GeoPort } from '../../adapters/geo/index.js';
import * as repo from './repository.js';
import type { CategoryWithProductRows, MerchantRow, ProductRow } from './repository.js';

/** Candidate rows fetched for a geo-sorted page before distance narrows them down. */
const GEO_CANDIDATE_CAP = 500;
/** Default search radius when a near point is given without an explicit one. */
const DEFAULT_RADIUS_M = 5000;

export interface MerchantSummaryDto {
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
  distanceMeters?: number;
}

function toDto(row: MerchantRow, distanceMeters?: number): MerchantSummaryDto {
  const dto: MerchantSummaryDto = {
    id: row.id,
    name: row.name,
    vertical: row.vertical,
    cityId: row.cityId,
    zoneId: row.zoneId,
    latitude: row.latitude,
    longitude: row.longitude,
    rating: row.rating,
    prepTimeMinutes: row.prepTimeMinutes,
    isOpen: row.isOpen,
    status: row.status,
  };
  if (distanceMeters !== undefined) dto.distanceMeters = distanceMeters;
  return dto;
}

export type MerchantSort = 'distance' | 'rating' | 'eta' | 'recent';

export interface ListMerchantsParams {
  cityId: string;
  vertical?: Vertical;
  minRating?: number;
  sortBy?: MerchantSort;
  latitude?: number;
  longitude?: number;
  radiusM?: number;
  cursor?: string;
  limit: number;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export function createCatalogService(geo: GeoPort) {
  /**
   * Two pagination strategies, chosen by whether a near point was given.
   * Without one, ordinary DB cursor pagination is correct and cheap. With
   * one, the sort key (distance) is computed, not a column, so a proper DB
   * cursor cannot express it; instead this fetches a capped candidate set
   * via the indexed bounding-box prefilter, sorts by exact haversine
   * distance in memory, and paginates that array with an offset encoded as
   * the cursor. See docs/build-plan.md section 1.6.
   */
  async function listMerchants(params: ListMerchantsParams): Promise<Page<MerchantSummaryDto>> {
    if (params.latitude === undefined || params.longitude === undefined) {
      // 'distance' has no meaning without a near point; fall back to
      // 'recent' rather than reject the combination outright, since a
      // frontend's default sort choice should not have to know whether the
      // user has shared a location yet.
      const sortBy = params.sortBy === 'distance' || !params.sortBy ? 'recent' : params.sortBy;
      const page = await repo.findMerchantsPage({
        cityId: params.cityId,
        ...(params.vertical ? { vertical: params.vertical } : {}),
        ...(params.minRating !== undefined ? { minRating: params.minRating } : {}),
        sortBy,
        ...(params.cursor ? { cursor: params.cursor } : {}),
        limit: params.limit,
      });
      return { items: page.items.map((row) => toDto(row)), nextCursor: page.nextCursor };
    }

    const center = { latitude: params.latitude, longitude: params.longitude };
    const radiusM = params.radiusM ?? DEFAULT_RADIUS_M;
    const box = geo.boundingBox(center, radiusM);

    const candidates = await repo.findMerchantsInBox({
      cityId: params.cityId,
      ...(params.vertical ? { vertical: params.vertical } : {}),
      ...(params.minRating !== undefined ? { minRating: params.minRating } : {}),
      box,
      maxCandidates: GEO_CANDIDATE_CAP,
    });

    const withDistance = candidates
      .map((row) => ({ row, distanceMeters: geo.distanceMeters(center, row) }))
      .filter((c) => c.distanceMeters <= radiusM);

    // Distance is always computed and returned once a near point is given,
    // even when the page is ordered by rating or ETA instead - a frontend
    // showing "12 min away" alongside a rating-sorted list still needs the
    // number, it just is not what determined the order.
    switch (params.sortBy) {
      case 'rating':
        withDistance.sort((a, b) => b.row.rating - a.row.rating);
        break;
      case 'eta':
        withDistance.sort((a, b) => a.row.prepTimeMinutes - b.row.prepTimeMinutes);
        break;
      default:
        withDistance.sort((a, b) => a.distanceMeters - b.distanceMeters);
    }

    const offset = params.cursor ? Number.parseInt(params.cursor, 10) : 0;
    const validOffset = Number.isInteger(offset) && offset >= 0 ? offset : 0;
    const page = withDistance.slice(validOffset, validOffset + params.limit);
    const nextOffset = validOffset + params.limit;
    const hasMore = nextOffset < withDistance.length;

    return {
      items: page.map((c) => toDto(c.row, Math.round(c.distanceMeters))),
      nextCursor: hasMore ? String(nextOffset) : null,
    };
  }

  async function searchCatalog(params: {
    cityId: string;
    query: string;
    limit: number;
  }): Promise<{ merchants: MerchantSummaryDto[]; products: repo.SearchRow['products'] }> {
    const result = await repo.searchCatalog(params);
    return {
      merchants: result.merchants.map((row) => toDto(row)),
      products: result.products,
    };
  }

  async function getMerchantMenu(merchantId: string): Promise<{
    merchant: MerchantSummaryDto;
    categories: CategoryWithProductRows[];
  } | null> {
    const result = await repo.findMerchantMenu(merchantId);
    if (!result) return null;
    return { merchant: toDto(result.merchant), categories: result.categories };
  }

  async function createMerchant(input: {
    name: string;
    vertical: Vertical;
    cityId: string;
    zoneId: string;
    latitude: number;
    longitude: number;
    prepTimeMinutes: number;
  }): Promise<MerchantSummaryDto> {
    const row = await repo.createMerchant(input);
    return toDto(row);
  }

  async function updateMerchant(
    id: string,
    input: { name?: string; isOpen?: boolean; prepTimeMinutes?: number }
  ): Promise<MerchantSummaryDto> {
    const row = await repo.updateMerchant(id, input);
    return toDto(row);
  }

  return {
    listMerchants,
    searchCatalog,
    getMerchantMenu,
    createMerchant,
    updateMerchant,
    findMerchantById: repo.findMerchantById,
    createCategory: repo.createCategory,
    findCategoryOwner: repo.findCategoryOwner,
    updateCategory: repo.updateCategory,
    deleteCategory: repo.deleteCategory,
    createProduct: repo.createProduct,
    findProductOwner: repo.findProductOwner,
    updateProduct: repo.updateProduct,
    deleteProduct: repo.deleteProduct,
  };
}

export type CatalogService = ReturnType<typeof createCatalogService>;
export type { MerchantRow, ProductRow, CategoryWithProductRows };
