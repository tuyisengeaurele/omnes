/**
 * Cart request schemas, shared between the API and the frontends.
 */

import { z } from 'zod';

export const addCartItemSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.coerce.number().int().min(1).max(99),
  notes: z.string().trim().max(500).optional(),
});
export type AddCartItemInput = z.infer<typeof addCartItemSchema>;

export const updateCartItemQuantitySchema = z.object({
  quantity: z.coerce.number().int().min(1).max(99),
});
export type UpdateCartItemQuantityInput = z.infer<typeof updateCartItemQuantitySchema>;
