/**
 * Minimal address persistence: create only. Address management (listing,
 * editing, a default address, map pin-drop) is customer-web territory in a
 * later phase; checkout needs somewhere to save a delivery point today, so
 * it creates one inline from the coordinates the client sends rather than
 * requiring a saved address to already exist.
 */

import { getDb } from '../../platform/db.js';

export interface CreateAddressInput {
  userId: string;
  label: string;
  latitude: number;
  longitude: number;
  landmark?: string;
}

export interface AddressRecord {
  id: string;
  latitude: number;
  longitude: number;
}

export async function createAddress(input: CreateAddressInput): Promise<AddressRecord> {
  const address = await getDb().address.create({
    data: {
      userId: input.userId,
      label: input.label,
      latitude: input.latitude,
      longitude: input.longitude,
      ...(input.landmark !== undefined ? { landmark: input.landmark } : {}),
    },
    select: { id: true, latitude: true, longitude: true },
  });
  return {
    id: address.id,
    latitude: address.latitude.toNumber(),
    longitude: address.longitude.toNumber(),
  };
}
