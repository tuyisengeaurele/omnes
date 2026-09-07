/**
 * Checkout request schema. MTN Mobile Money and Airtel Money only for now -
 * the PaymentPort this ships against implements those two; cash needs a
 * driver-collection flow and card needs a separate gateway integration,
 * neither of which exists yet.
 */

import { z } from 'zod';
import { phoneE164Schema } from './primitives.js';

export const checkoutAddressSchema = z.object({
  label: z.string().trim().min(1, 'label is required').max(120),
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  landmark: z.string().trim().max(200).optional(),
});
export type CheckoutAddressInput = z.infer<typeof checkoutAddressSchema>;

export const checkoutPaymentMethodSchema = z.enum(['MTN_MOMO', 'AIRTEL']);
export type CheckoutPaymentMethod = z.infer<typeof checkoutPaymentMethodSchema>;

export const checkoutSchema = z.object({
  address: checkoutAddressSchema,
  paymentMethod: checkoutPaymentMethodSchema,
  payerPhone: phoneE164Schema,
  /**
   * Generated client-side once per checkout attempt and resent unchanged on
   * any retry, so a network failure or a double-tap on the button cannot
   * place the order twice.
   */
  idempotencyKey: z.string().uuid(),
});
export type CheckoutInput = z.infer<typeof checkoutSchema>;

export const paymentWebhookSchema = z.object({
  providerRef: z.string().min(1),
  status: z.enum(['SUCCEEDED', 'FAILED']),
  errorCode: z.string().optional(),
  errorMessage: z.string().optional(),
});
export type PaymentWebhookInput = z.infer<typeof paymentWebhookSchema>;
