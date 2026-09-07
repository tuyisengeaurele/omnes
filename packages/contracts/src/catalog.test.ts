import { describe, expect, it } from 'vitest';
import {
  createCategorySchema,
  createMerchantSchema,
  createProductSchema,
  listMerchantsQuerySchema,
  searchCatalogQuerySchema,
  updateCategorySchema,
  updateMerchantSchema,
  updateProductSchema,
} from './catalog.js';

const CITY_ID = '950a5a76-6872-4e8b-8e6d-7d9eaddb6cbc';
const ZONE_ID = '33c5c447-de04-41be-a35d-83b2e3f03586';
const USER_ID = '08ef91de-b312-4d5c-a7b7-6a35492168a2';

describe('listMerchantsQuerySchema', () => {
  it('accepts a query with only cityId', () => {
    expect(listMerchantsQuerySchema.safeParse({ cityId: CITY_ID }).success).toBe(true);
  });

  it('accepts latitude and longitude together', () => {
    const result = listMerchantsQuerySchema.safeParse({
      cityId: CITY_ID,
      latitude: '-1.9441',
      longitude: '30.0619',
    });
    expect(result.success).toBe(true);
  });

  it('rejects latitude without longitude', () => {
    const result = listMerchantsQuerySchema.safeParse({ cityId: CITY_ID, latitude: '-1.9441' });
    expect(result.success).toBe(false);
  });

  it('rejects longitude without latitude', () => {
    const result = listMerchantsQuerySchema.safeParse({ cityId: CITY_ID, longitude: '30.0619' });
    expect(result.success).toBe(false);
  });

  it('rejects a cityId that is not a uuid', () => {
    expect(listMerchantsQuerySchema.safeParse({ cityId: 'not-a-uuid' }).success).toBe(false);
  });

  it('rejects an out-of-range latitude', () => {
    const result = listMerchantsQuerySchema.safeParse({
      cityId: CITY_ID,
      latitude: '200',
      longitude: '30',
    });
    expect(result.success).toBe(false);
  });

  it('accepts a minRating filter and a sortBy', () => {
    const result = listMerchantsQuerySchema.safeParse({
      cityId: CITY_ID,
      minRating: '4',
      sortBy: 'rating',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a minRating above 5', () => {
    const result = listMerchantsQuerySchema.safeParse({ cityId: CITY_ID, minRating: '6' });
    expect(result.success).toBe(false);
  });

  it('rejects an unrecognized sortBy value', () => {
    const result = listMerchantsQuerySchema.safeParse({ cityId: CITY_ID, sortBy: 'price' });
    expect(result.success).toBe(false);
  });
});

describe('searchCatalogQuerySchema', () => {
  it('accepts a query with a search term', () => {
    expect(searchCatalogQuerySchema.safeParse({ cityId: CITY_ID, q: 'pizza' }).success).toBe(true);
  });

  it('rejects an empty search term', () => {
    expect(searchCatalogQuerySchema.safeParse({ cityId: CITY_ID, q: '' }).success).toBe(false);
  });
});

describe('createMerchantSchema', () => {
  it('accepts a valid payload and defaults prepTimeMinutes', () => {
    const result = createMerchantSchema.safeParse({
      name: 'Test Merchant',
      vertical: 'FOOD',
      cityId: CITY_ID,
      zoneId: ZONE_ID,
      latitude: -1.9441,
      longitude: 30.0619,
      ownerUserId: USER_ID,
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.prepTimeMinutes).toBe(15);
  });

  it('rejects a missing vertical', () => {
    const result = createMerchantSchema.safeParse({
      name: 'Test Merchant',
      cityId: CITY_ID,
      zoneId: ZONE_ID,
      latitude: -1.9441,
      longitude: 30.0619,
      ownerUserId: USER_ID,
    });
    expect(result.success).toBe(false);
  });
});

describe('updateMerchantSchema', () => {
  it('accepts a single field update', () => {
    expect(updateMerchantSchema.safeParse({ isOpen: false }).success).toBe(true);
  });

  it('rejects an empty update', () => {
    expect(updateMerchantSchema.safeParse({}).success).toBe(false);
  });
});

describe('category schemas', () => {
  it('creates with a default sortOrder', () => {
    const result = createCategorySchema.safeParse({ name: 'Grills' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.sortOrder).toBe(0);
  });

  it('rejects an empty category update', () => {
    expect(updateCategorySchema.safeParse({}).success).toBe(false);
  });
});

describe('product schemas', () => {
  it('accepts a valid product', () => {
    const result = createProductSchema.safeParse({
      name: 'Grilled tilapia',
      priceMinor: '6500',
      currency: 'rwf',
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.currency).toBe('RWF');
  });

  it('rejects a decimal priceMinor', () => {
    const result = createProductSchema.safeParse({
      name: 'Grilled tilapia',
      priceMinor: '65.50',
      currency: 'RWF',
    });
    expect(result.success).toBe(false);
  });

  it('allows clearing categoryId via null on update', () => {
    const result = updateProductSchema.safeParse({ categoryId: null });
    expect(result.success).toBe(true);
  });

  it('rejects an empty product update', () => {
    expect(updateProductSchema.safeParse({}).success).toBe(false);
  });
});
