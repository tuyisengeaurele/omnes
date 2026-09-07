/**
 * Enum values shared between the API and the frontends.
 *
 * These mirror the enums in apps/api/prisma/schema.prisma. They are kept as
 * a second, hand-written list rather than generated from the Prisma schema
 * on purpose: this package must not depend on Prisma, since it is imported
 * by browser bundles, and Prisma's generated client is a Node-only package.
 *
 * Keep the two in sync by hand. A mismatch here is caught immediately by
 * any integration test that round-trips a real enum value through the API.
 */

import { z } from 'zod';

export const verticalSchema = z.enum(['FOOD', 'GROCERY', 'PARCEL']);
export type Vertical = z.infer<typeof verticalSchema>;

export const orderStatusSchema = z.enum([
  'DRAFT',
  'PENDING_PAYMENT',
  'PAID',
  'MERCHANT_PENDING',
  'ACCEPTED',
  'PREPARING',
  'READY_FOR_PICKUP',
  'ASSIGNED',
  'PICKED_UP',
  'DELIVERED',
  'REJECTED',
  'CANCELLED',
  'REFUNDED',
]);
export type OrderStatus = z.infer<typeof orderStatusSchema>;

/** Terminal states. An order in one of these never transitions again. */
export const TERMINAL_ORDER_STATUSES: readonly OrderStatus[] = [
  'DELIVERED',
  'REJECTED',
  'CANCELLED',
  'REFUNDED',
];

export const paymentMethodSchema = z.enum(['MTN_MOMO', 'AIRTEL', 'CARD', 'CASH', 'WALLET']);
export type PaymentMethod = z.infer<typeof paymentMethodSchema>;

export const roleNameSchema = z.enum([
  'CUSTOMER',
  'DRIVER',
  'MERCHANT_OWNER',
  'OPS',
  'SUPPORT',
  'FINANCE',
  'SUPER_ADMIN',
]);
export type RoleName = z.infer<typeof roleNameSchema>;

/** Internal staff roles, as distinct from the two customer-facing identities. */
export const STAFF_ROLES: readonly RoleName[] = ['OPS', 'SUPPORT', 'FINANCE', 'SUPER_ADMIN'];

export const approvalStatusSchema = z.enum(['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED']);
export type ApprovalStatus = z.infer<typeof approvalStatusSchema>;

export const vehicleTypeSchema = z.enum(['MOTO', 'CAR', 'VAN', 'BICYCLE']);
export type VehicleType = z.infer<typeof vehicleTypeSchema>;

export const notificationChannelSchema = z.enum(['PUSH', 'SMS']);
export type NotificationChannel = z.infer<typeof notificationChannelSchema>;

export const issueCategorySchema = z.enum([
  'MISSING_ITEM',
  'WRONG_ITEM',
  'LATE_DELIVERY',
  'DAMAGED',
  'OTHER',
]);
export type IssueCategory = z.infer<typeof issueCategorySchema>;

export const ratingSubjectSchema = z.enum(['DRIVER', 'MERCHANT']);
export type RatingSubject = z.infer<typeof ratingSubjectSchema>;

export const parcelSizeSchema = z.enum(['SMALL', 'MEDIUM', 'LARGE']);
export type ParcelSize = z.infer<typeof parcelSizeSchema>;
