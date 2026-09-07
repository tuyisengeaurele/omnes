/**
 * Haversine GeoPort implementation. Pure math, no external service, so this
 * is unit tested directly rather than only through whatever calls it.
 */

import type { Coordinates } from '@omnes/contracts';
import type { BoundingBox, GeoPort } from './index.js';

/** Mean Earth radius in meters. Good enough for city-scale delivery distances. */
const EARTH_RADIUS_M = 6_371_000;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function haversineDistanceMeters(a: Coordinates, b: Coordinates): number {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);

  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(Math.min(1, h)));
}

/**
 * Latitude degrees are a fixed distance apart everywhere; longitude degrees
 * shrink toward the poles by a factor of cos(latitude). cos is clamped away
 * from zero so a center point near a pole cannot blow the box up to an
 * unusable width instead of just a wide-but-finite one.
 */
function haversineBoundingBox(center: Coordinates, radiusM: number): BoundingBox {
  const metersPerDegreeLat = (Math.PI / 180) * EARTH_RADIUS_M;
  const deltaLat = radiusM / metersPerDegreeLat;

  const cosLat = Math.max(Math.cos(toRadians(center.latitude)), 0.01);
  const deltaLon = deltaLat / cosLat;

  return {
    minLatitude: Math.max(center.latitude - deltaLat, -90),
    maxLatitude: Math.min(center.latitude + deltaLat, 90),
    minLongitude: Math.max(center.longitude - deltaLon, -180),
    maxLongitude: Math.min(center.longitude + deltaLon, 180),
  };
}

export const haversineGeoAdapter: GeoPort = {
  distanceMeters: haversineDistanceMeters,
  boundingBox: haversineBoundingBox,
};
