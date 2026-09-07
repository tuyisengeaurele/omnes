/**
 * Request schemas for the identity endpoints. Shared between the API, which
 * validates every request body against these, and the frontends, which
 * import the inferred types for their forms and API clients.
 */

import { z } from 'zod';
import { phoneE164Schema } from './primitives.js';
import { vehicleTypeSchema } from './enums.js';

/** A numeric OTP code. Length is config-driven server-side (4-10 digits), so this stays loose. */
const otpCodeSchema = z.string().regex(/^\d{4,10}$/, 'must be a numeric code');

export const requestOtpSchema = z.object({
  phoneE164: phoneE164Schema,
});
export type RequestOtpInput = z.infer<typeof requestOtpSchema>;

export const registerSchema = z.object({
  phoneE164: phoneE164Schema,
  displayName: z.string().trim().min(1, 'display name is required').max(120),
  code: otpCodeSchema,
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  phoneE164: phoneE164Schema,
  code: otpCodeSchema,
});
export type LoginInput = z.infer<typeof loginSchema>;

/** Ops-only: provisions a driver for a user who already has an account. See identity/driver.routes.ts. */
export const provisionDriverSchema = z.object({
  userId: z.string().uuid(),
  vehicleType: vehicleTypeSchema,
});
export type ProvisionDriverInput = z.infer<typeof provisionDriverSchema>;
