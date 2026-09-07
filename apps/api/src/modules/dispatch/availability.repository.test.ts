/**
 * Availability and candidate-search tests against the real database
 * (omnes_test) - the eligibility filter here spans three tables
 * (DriverAvailability, DriverProfile, Assignment) plus a distinct-on
 * query, exactly the kind of thing a fake would not actually prove.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { getDb, disconnectDb } from '../../platform/db.js';
import { haversineGeoAdapter } from '../../adapters/geo/haversineAdapter.js';
import {
  setDriverOnline,
  setDriverOffline,
  recordDriverLocation,
  findCandidateLocationsInBox,
} from './availability.repository.js';

const KIGALI_CENTER = { latitude: -1.9441, longitude: 30.0619 };
const NEARBY = { latitude: -1.945, longitude: 30.063 };
const FAR_AWAY = { latitude: -2.6, longitude: 29.7 }; // Huye, well outside any Kigali-scale box

const box = haversineGeoAdapter.boundingBox(KIGALI_CENTER, 5000);

let phoneCounter = 0;
function uniquePhone(): string {
  phoneCounter += 1;
  return `+2507${String(86000000 + phoneCounter).padStart(8, '0')}`;
}

describe('availability.repository', () => {
  const createdUserIds: string[] = [];
  const createdDriverIds: string[] = [];
  let cityId: string;
  let zoneId: string;
  let merchantId: string;
  let addressId: string;
  let customerId: string;

  async function createDriver(status: 'APPROVED' | 'PENDING' = 'APPROVED') {
    const db = getDb();
    const user = await db.user.create({
      data: { phoneE164: uniquePhone(), displayName: 'Test Driver' },
    });
    createdUserIds.push(user.id);
    const profile = await db.driverProfile.create({
      data: { userId: user.id, vehicleType: 'MOTO', status },
    });
    createdDriverIds.push(profile.id);
    return profile.id;
  }

  async function createActiveAssignmentFor(driverId: string): Promise<void> {
    const db = getDb();
    const order = await db.order.create({
      data: {
        orderNumber: `OM-TEST-${randomUUID()}`,
        customerId,
        merchantId,
        vertical: 'FOOD',
        status: 'ASSIGNED',
        addressId,
        subtotalMinor: 1000n,
        deliveryFeeMinor: 500n,
        serviceFeeMinor: 0n,
        totalMinor: 1500n,
        currency: 'RWF',
      },
    });
    await db.assignment.create({ data: { orderId: order.id, driverId } });
  }

  beforeAll(async () => {
    const db = getDb();
    const city = await db.city.create({
      data: {
        code: `DR${Date.now()}`,
        name: 'Dispatch Test City',
        countryCode: 'RW',
        currency: 'RWF',
        timezone: 'Africa/Kigali',
        activeVerticals: ['FOOD'],
      },
    });
    cityId = city.id;
    const zone = await db.zone.create({
      data: {
        cityId,
        name: 'Dispatch Test Zone',
        polygon: { type: 'Point', coordinates: [30.0619, -1.9441] },
        deliveryRadiusM: 5000,
      },
    });
    zoneId = zone.id;
    const merchant = await db.merchant.create({
      data: {
        name: 'Dispatch Test Merchant',
        vertical: 'FOOD',
        cityId,
        zoneId,
        latitude: KIGALI_CENTER.latitude,
        longitude: KIGALI_CENTER.longitude,
      },
    });
    merchantId = merchant.id;

    const customerUser = await db.user.create({
      data: { phoneE164: uniquePhone(), displayName: 'Dispatch Test Customer' },
    });
    createdUserIds.push(customerUser.id);
    customerId = customerUser.id;
    const address = await db.address.create({
      data: { userId: customerId, label: 'Home', latitude: -1.95, longitude: 30.07 },
    });
    addressId = address.id;
  });

  afterAll(async () => {
    const db = getDb();
    await db.assignment.deleteMany({ where: { driverId: { in: createdDriverIds } } });
    await db.order.deleteMany({ where: { merchantId } });
    await db.driverLocation.deleteMany({ where: { driverId: { in: createdDriverIds } } });
    await db.driverAvailability.deleteMany({ where: { driverId: { in: createdDriverIds } } });
    await db.driverProfile.deleteMany({ where: { id: { in: createdDriverIds } } });
    await db.address.deleteMany({ where: { id: addressId } });
    await db.merchant.deleteMany({ where: { id: merchantId } });
    await db.zone.deleteMany({ where: { id: zoneId } });
    await db.city.deleteMany({ where: { id: cityId } });
    for (const userId of createdUserIds) {
      await db.user.deleteMany({ where: { id: userId } });
    }
    await disconnectDb();
  });

  describe('setDriverOnline / setDriverOffline', () => {
    it('creates an availability row on first call and marks it online', async () => {
      const driverId = await createDriver();
      await setDriverOnline(driverId, 'MOTO');

      const row = await getDb().driverAvailability.findUniqueOrThrow({ where: { driverId } });
      expect(row.isOnline).toBe(true);
      expect(row.vehicleType).toBe('MOTO');
    });

    it('is a no-op, not an error, going offline before ever going online', async () => {
      const driverId = await createDriver();
      await expect(setDriverOffline(driverId)).resolves.toBeUndefined();

      const row = await getDb().driverAvailability.findUnique({ where: { driverId } });
      expect(row).toBeNull();
    });

    it('flips an online driver back offline', async () => {
      const driverId = await createDriver();
      await setDriverOnline(driverId, 'MOTO');
      await setDriverOffline(driverId);

      const row = await getDb().driverAvailability.findUniqueOrThrow({ where: { driverId } });
      expect(row.isOnline).toBe(false);
    });
  });

  describe('findCandidateLocationsInBox', () => {
    it('returns an online, approved, unassigned driver reporting a location in the box', async () => {
      const driverId = await createDriver();
      await setDriverOnline(driverId, 'MOTO');
      await recordDriverLocation(driverId, { ...NEARBY, accuracyM: 10 });

      const candidates = await findCandidateLocationsInBox({ box, excludeDriverIds: [] });
      expect(candidates.map((c) => c.driverId)).toContain(driverId);
    });

    it('only returns the most recently recorded location for a driver with several', async () => {
      const driverId = await createDriver();
      await setDriverOnline(driverId, 'MOTO');
      await recordDriverLocation(driverId, { ...KIGALI_CENTER, accuracyM: 10 });
      await recordDriverLocation(driverId, { ...NEARBY, accuracyM: 10 });

      const candidates = await findCandidateLocationsInBox({ box, excludeDriverIds: [] });
      const match = candidates.find((c) => c.driverId === driverId);
      expect(match).toBeDefined();
      expect(match?.latitude).toBeCloseTo(NEARBY.latitude, 5);
      expect(match?.longitude).toBeCloseTo(NEARBY.longitude, 5);
    });

    it('excludes a driver who is offline', async () => {
      const driverId = await createDriver();
      await setDriverOnline(driverId, 'MOTO');
      await recordDriverLocation(driverId, { ...NEARBY, accuracyM: 10 });
      await setDriverOffline(driverId);

      const candidates = await findCandidateLocationsInBox({ box, excludeDriverIds: [] });
      expect(candidates.map((c) => c.driverId)).not.toContain(driverId);
    });

    it('excludes a driver whose profile is not yet approved', async () => {
      const driverId = await createDriver('PENDING');
      await setDriverOnline(driverId, 'MOTO');
      await recordDriverLocation(driverId, { ...NEARBY, accuracyM: 10 });

      const candidates = await findCandidateLocationsInBox({ box, excludeDriverIds: [] });
      expect(candidates.map((c) => c.driverId)).not.toContain(driverId);
    });

    it('excludes a driver already on an active assignment', async () => {
      const driverId = await createDriver();
      await setDriverOnline(driverId, 'MOTO');
      await recordDriverLocation(driverId, { ...NEARBY, accuracyM: 10 });
      await createActiveAssignmentFor(driverId);

      const candidates = await findCandidateLocationsInBox({ box, excludeDriverIds: [] });
      expect(candidates.map((c) => c.driverId)).not.toContain(driverId);
    });

    it('excludes a driver explicitly passed in excludeDriverIds', async () => {
      const driverId = await createDriver();
      await setDriverOnline(driverId, 'MOTO');
      await recordDriverLocation(driverId, { ...NEARBY, accuracyM: 10 });

      const candidates = await findCandidateLocationsInBox({ box, excludeDriverIds: [driverId] });
      expect(candidates.map((c) => c.driverId)).not.toContain(driverId);
    });

    it('excludes a driver reporting a location outside the box', async () => {
      const driverId = await createDriver();
      await setDriverOnline(driverId, 'MOTO');
      await recordDriverLocation(driverId, { ...FAR_AWAY, accuracyM: 10 });

      const candidates = await findCandidateLocationsInBox({ box, excludeDriverIds: [] });
      expect(candidates.map((c) => c.driverId)).not.toContain(driverId);
    });
  });
});
