/**
 * Driver availability, location, and the candidate search dispatch runs
 * against. Same two-step geo pattern as catalog's merchant search: an
 * indexed bounding-box prefilter here, exact haversine distance and the
 * final radius cutoff in dispatch.service.ts - see that file, and
 * docs/build-plan.md section 1.6.
 */

import { getDb } from '../../platform/db.js';
import type { BoundingBox } from '../../adapters/geo/index.js';
import type { VehicleType } from '@omnes/contracts';

export async function setDriverOnline(
  driverId: string,
  vehicleType: VehicleType,
  currentZoneId?: string
): Promise<void> {
  await getDb().driverAvailability.upsert({
    where: { driverId },
    create: {
      driverId,
      isOnline: true,
      vehicleType,
      lastSeenAt: new Date(),
      ...(currentZoneId !== undefined ? { currentZoneId } : {}),
    },
    update: {
      isOnline: true,
      vehicleType,
      lastSeenAt: new Date(),
      ...(currentZoneId !== undefined ? { currentZoneId } : {}),
    },
  });
}

/**
 * A no-op, not an error, for a driver who has never gone online before -
 * there is nothing to mark offline. updateMany rather than update so that
 * case matches zero rows instead of throwing.
 */
export async function setDriverOffline(driverId: string): Promise<void> {
  await getDb().driverAvailability.updateMany({
    where: { driverId },
    data: { isOnline: false, lastSeenAt: new Date() },
  });
}

export async function recordDriverLocation(
  driverId: string,
  params: { latitude: number; longitude: number; accuracyM: number }
): Promise<void> {
  await getDb().driverLocation.create({
    data: {
      driverId,
      latitude: params.latitude,
      longitude: params.longitude,
      accuracyM: params.accuracyM,
    },
  });
}

export interface CandidateLocationRow {
  driverId: string;
  latitude: number;
  longitude: number;
}

/**
 * Same safety cap as catalog's GEO_CANDIDATE_CAP, and the same reasoning: a
 * query-level ceiling, generous enough that truncating before the
 * exact-distance sort and ranking in dispatch.service.ts essentially never
 * excludes a real nearest driver in practice, while still bounding the
 * query against an implausibly dense zone.
 */
const CANDIDATE_QUERY_CAP = 500;

/**
 * Online, approved, not already on an active assignment, not one of the
 * ids the current dispatch attempt has already offered - and reporting a
 * location inside the given box. The box is a cheap indexed prefilter;
 * dispatch.service.ts computes exact distance and applies the real radius
 * cutoff against what this returns. One query, not a fetch-ids-then-fetch-
 * locations pair: the box filter and the eligibility filters both need to
 * apply before CANDIDATE_QUERY_CAP truncates anything, the same ordering
 * catalog's findMerchantsInBox uses.
 *
 * "Latest location per driver" is DISTINCT ON in Postgres, which Prisma's
 * `distinct` option produces when paired with an orderBy that starts with
 * the distinct field - verified against a real database, not assumed.
 */
export async function findCandidateLocationsInBox(params: {
  box: BoundingBox;
  excludeDriverIds: string[];
}): Promise<CandidateLocationRow[]> {
  const rows = await getDb().driverLocation.findMany({
    where: {
      latitude: { gte: params.box.minLatitude, lte: params.box.maxLatitude },
      longitude: { gte: params.box.minLongitude, lte: params.box.maxLongitude },
      ...(params.excludeDriverIds.length > 0
        ? { driverId: { notIn: params.excludeDriverIds } }
        : {}),
      driver: {
        status: 'APPROVED',
        availability: { isOnline: true },
        assignments: { none: { completedAt: null } },
      },
    },
    distinct: ['driverId'],
    orderBy: [{ driverId: 'asc' }, { recordedAt: 'desc' }],
    take: CANDIDATE_QUERY_CAP,
  });

  return rows.map((row) => ({
    driverId: row.driverId,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
  }));
}
