/**
 * Order lifecycle request schemas, shared between the API and the
 * frontends. Order history and detail pagination reuses
 * paginationQuerySchema from primitives.ts directly - there is nothing
 * order-specific about it.
 */

import { z } from 'zod';

/** Reject and cancel both take an optional human-readable reason; accept needs no body at all. */
export const orderActionReasonSchema = z.object({
  reason: z.string().trim().min(1).max(500).optional(),
});
export type OrderActionReasonInput = z.infer<typeof orderActionReasonSchema>;
