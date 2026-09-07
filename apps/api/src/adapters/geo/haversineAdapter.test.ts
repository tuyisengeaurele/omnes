import { describe, expect, it } from 'vitest';
import { haversineGeoAdapter } from './haversineAdapter.js';

const KIGALI_CENTER = { latitude: -1.9441, longitude: 30.0619 };
// Kigali International Airport, roughly 9-10km from the city center.
const KIGALI_AIRPORT = { latitude: -1.9686, longitude: 30.1395 };
// Nairobi, ~740km from Kigali - a real, well-known intercity distance to sanity-check against.
const NAIROBI = { latitude: -1.2921, longitude: 36.8219 };

describe('haversineGeoAdapter.distanceMeters', () => {
  it('returns zero for identical points', () => {
    expect(haversineGeoAdapter.distanceMeters(KIGALI_CENTER, KIGALI_CENTER)).toBe(0);
  });

  it('is symmetric', () => {
    const ab = haversineGeoAdapter.distanceMeters(KIGALI_CENTER, KIGALI_AIRPORT);
    const ba = haversineGeoAdapter.distanceMeters(KIGALI_AIRPORT, KIGALI_CENTER);
    expect(ab).toBeCloseTo(ba, 6);
  });

  it('matches the known approximate distance between two Kigali landmarks', () => {
    const meters = haversineGeoAdapter.distanceMeters(KIGALI_CENTER, KIGALI_AIRPORT);
    // Real road distance is ~10-12km; straight-line should be a bit under that.
    expect(meters).toBeGreaterThan(8000);
    expect(meters).toBeLessThan(12000);
  });

  it('matches the known approximate distance between Kigali and Nairobi', () => {
    const meters = haversineGeoAdapter.distanceMeters(KIGALI_CENTER, NAIROBI);
    const km = meters / 1000;
    expect(km).toBeGreaterThan(700);
    expect(km).toBeLessThan(780);
  });

  it('computes one degree of longitude at the equator as roughly 111km', () => {
    const meters = haversineGeoAdapter.distanceMeters(
      { latitude: 0, longitude: 0 },
      { latitude: 0, longitude: 1 }
    );
    expect(meters / 1000).toBeCloseTo(111.32, 0);
  });

  it('computes one degree of latitude anywhere as roughly 111km', () => {
    const meters = haversineGeoAdapter.distanceMeters(
      { latitude: 10, longitude: 20 },
      { latitude: 11, longitude: 20 }
    );
    expect(meters / 1000).toBeCloseTo(111.32, 0);
  });
});

describe('haversineGeoAdapter.boundingBox', () => {
  it('contains the center point', () => {
    const box = haversineGeoAdapter.boundingBox(KIGALI_CENTER, 5000);
    expect(KIGALI_CENTER.latitude).toBeGreaterThanOrEqual(box.minLatitude);
    expect(KIGALI_CENTER.latitude).toBeLessThanOrEqual(box.maxLatitude);
    expect(KIGALI_CENTER.longitude).toBeGreaterThanOrEqual(box.minLongitude);
    expect(KIGALI_CENTER.longitude).toBeLessThanOrEqual(box.maxLongitude);
  });

  it('contains every point the exact distance check would also accept', () => {
    const center = KIGALI_CENTER;
    const radiusM = 3000;
    const box = haversineGeoAdapter.boundingBox(center, radiusM);

    // A ring of points at increasing bearings, each exactly radiusM away by
    // straight-line distance (approximately, via a small-angle offset) -
    // every one of them must fall inside the box, since the box is the
    // prefilter and must never be tighter than the real distance check.
    const metersPerDegreeLat = (Math.PI / 180) * 6_371_000;
    for (let bearingDeg = 0; bearingDeg < 360; bearingDeg += 15) {
      const bearing = (bearingDeg * Math.PI) / 180;
      const deltaLat = (radiusM * Math.cos(bearing)) / metersPerDegreeLat;
      const cosLat = Math.cos((center.latitude * Math.PI) / 180);
      const deltaLon = (radiusM * Math.sin(bearing)) / (metersPerDegreeLat * cosLat);
      const point = {
        latitude: center.latitude + deltaLat,
        longitude: center.longitude + deltaLon,
      };

      expect(point.latitude).toBeGreaterThanOrEqual(box.minLatitude);
      expect(point.latitude).toBeLessThanOrEqual(box.maxLatitude);
      expect(point.longitude).toBeGreaterThanOrEqual(box.minLongitude);
      expect(point.longitude).toBeLessThanOrEqual(box.maxLongitude);
    }
  });

  it('clamps latitude to the valid range near the pole', () => {
    const box = haversineGeoAdapter.boundingBox({ latitude: 89.9, longitude: 0 }, 50000);
    expect(box.maxLatitude).toBeLessThanOrEqual(90);
  });

  it('clamps longitude to the valid range near the antimeridian', () => {
    const box = haversineGeoAdapter.boundingBox({ latitude: 0, longitude: 179.9 }, 50000);
    expect(box.maxLongitude).toBeLessThanOrEqual(180);
  });

  it('does not blow up to an unusable width near the pole', () => {
    const box = haversineGeoAdapter.boundingBox({ latitude: 89.99, longitude: 0 }, 5000);
    expect(Number.isFinite(box.minLongitude)).toBe(true);
    expect(Number.isFinite(box.maxLongitude)).toBe(true);
  });
});
