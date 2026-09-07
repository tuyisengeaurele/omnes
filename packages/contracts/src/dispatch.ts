/**
 * Dispatch request schemas: driver availability and location reporting.
 * Shared between the API and whatever eventually drives a driver's own
 * client - the driver app itself is out of MVP scope (see
 * docs/build-plan.md section 9), so nothing consumes these yet, but the
 * shape belongs here regardless, same as every other request contract.
 */

import { z } from 'zod';
import { latitudeSchema, longitudeSchema } from './primitives.js';

export const driverAvailabilityUpdateSchema = z.object({
  isOnline: z.boolean(),
  currentZoneId: z.string().uuid().optional(),
});
export type DriverAvailabilityUpdateInput = z.infer<typeof driverAvailabilityUpdateSchema>;

export const driverLocationSchema = z.object({
  latitude: latitudeSchema,
  longitude: longitudeSchema,
  accuracyM: z.coerce.number().positive(),
});
export type DriverLocationInput = z.infer<typeof driverLocationSchema>;
