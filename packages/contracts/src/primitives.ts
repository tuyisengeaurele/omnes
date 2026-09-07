/**
 * Primitive schemas reused across every entity contract. Nothing vertical- or
 * module-specific belongs here, only shapes common enough that a second
 * definition elsewhere would be a bug waiting to happen.
 */

import { z } from 'zod';

export const idSchema = z.string().uuid();

/**
 * E.164 phone number: an optional leading +, then 8 to 15 digits, the first
 * never a 0. Intentionally not Rwanda-only: FR-CUST-050 requires diaspora
 * customers to register with an international number.
 */
export const phoneE164Schema = z
  .string()
  .regex(/^\+?[1-9]\d{7,14}$/, 'must be an E.164 phone number, e.g. +250780000000');

export const emailSchema = z.string().trim().toLowerCase().email();

/**
 * A money amount in minor units alongside its currency, matching the
 * amountMinor/currency column pairing used throughout the schema. amountMinor
 * is transported as a string, since JSON has no 64-bit integer type and a
 * silently truncated total is a worse failure mode than an explicit parse.
 */
export const moneySchema = z.object({
  amountMinor: z.string().regex(/^-?\d+$/, 'must be an integer string'),
  currency: z.string().length(3).toUpperCase(),
});
export type Money = z.infer<typeof moneySchema>;

export const latitudeSchema = z.number().min(-90).max(90);
export const longitudeSchema = z.number().min(-180).max(180);

export const coordinatesSchema = z.object({
  latitude: latitudeSchema,
  longitude: longitudeSchema,
});
export type Coordinates = z.infer<typeof coordinatesSchema>;

/**
 * Every list endpoint is paginated (NFR-PERF and the build plan's own
 * performance section both require it). limit is capped so a client cannot
 * force an unbounded query by asking for one.
 */
export const paginationQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export function paginatedResponseSchema<ItemSchema extends z.ZodTypeAny>(itemSchema: ItemSchema) {
  return z.object({
    items: z.array(itemSchema),
    nextCursor: z.string().nullable(),
  });
}

/**
 * The shape of every error response the API returns. code is a stable,
 * machine-readable string a client can switch on; message is safe to show a
 * user; details never carries a stack trace, a query, or anything else that
 * belongs in a server log rather than a response body.
 */
export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;
