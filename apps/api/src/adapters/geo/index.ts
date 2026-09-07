/**
 * GeoPort: proximity queries ("drivers near this pickup", "merchants near
 * this address"). The MVP implementation is an indexed lat/lng bounding-box
 * prefilter plus haversine in application code; PostGIS is a later adapter
 * behind the same interface if it is ever needed. See docs/build-plan.md
 * section 1.6.
 */

import type { Coordinates } from '@omnes/contracts';

export interface BoundingBox {
  minLatitude: number;
  maxLatitude: number;
  minLongitude: number;
  maxLongitude: number;
}

export interface GeoPort {
  /** Great-circle distance between two points, in meters. */
  distanceMeters(a: Coordinates, b: Coordinates): number;
  /**
   * A rectangle guaranteed to contain every point within radiusM of center,
   * for a cheap indexed DB prefilter before the exact distance check below
   * narrows it down. Deliberately generous near the poles and the antimeridian
   * rather than exact, since a slightly oversized box only costs a few extra
   * candidate rows, while an undersized one would silently drop real matches.
   */
  boundingBox(center: Coordinates, radiusM: number): BoundingBox;
}
