import { describe, expect, it } from 'vitest';
import { driverAvailabilityUpdateSchema, driverLocationSchema } from './dispatch.js';

describe('driverAvailabilityUpdateSchema', () => {
  it('accepts going online with a zone', () => {
    const result = driverAvailabilityUpdateSchema.safeParse({
      isOnline: true,
      currentZoneId: '3b5c1f2a-1111-4a2b-9c3d-abcdefabcdef',
    });
    expect(result.success).toBe(true);
  });

  it('accepts going offline with no zone', () => {
    expect(driverAvailabilityUpdateSchema.safeParse({ isOnline: false }).success).toBe(true);
  });

  it('rejects a missing isOnline', () => {
    expect(driverAvailabilityUpdateSchema.safeParse({}).success).toBe(false);
  });

  it('rejects a non-uuid zone id', () => {
    const result = driverAvailabilityUpdateSchema.safeParse({
      isOnline: true,
      currentZoneId: 'not-a-uuid',
    });
    expect(result.success).toBe(false);
  });
});

describe('driverLocationSchema', () => {
  it('accepts a valid location ping', () => {
    const result = driverLocationSchema.safeParse({
      latitude: -1.9441,
      longitude: 30.0619,
      accuracyM: 8,
    });
    expect(result.success).toBe(true);
  });

  it('rejects an out-of-range latitude', () => {
    const result = driverLocationSchema.safeParse({ latitude: 95, longitude: 30, accuracyM: 8 });
    expect(result.success).toBe(false);
  });

  it('rejects a non-positive accuracy', () => {
    const result = driverLocationSchema.safeParse({ latitude: -1.9, longitude: 30, accuracyM: 0 });
    expect(result.success).toBe(false);
  });
});
