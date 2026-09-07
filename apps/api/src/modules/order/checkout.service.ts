/**
 * Checkout orchestration: validates the cart one last time, computes final
 * pricing against the real delivery distance, creates the order inside one
 * transaction, clears the cart, and initiates payment. Idempotent by
 * construction - see checkout.repository.ts's findCheckoutByIdempotencyKey,
 * checked before anything is created.
 */

import type { Vertical } from '@omnes/contracts';
import type { GeoPort } from '../../adapters/geo/index.js';
import type {
  InitiatePaymentInput,
  InitiatePaymentResult,
  PaymentMethod,
} from '../../adapters/payment/index.js';
import type { MerchantRow } from '../catalog/index.js';
import { recordProviderRef, applyInitiateFailure } from '../payment/index.js';
import type { CartService } from './cart.service.js';
import { findActiveFeeSchedule } from './cart.repository.js';
import { createAddress } from './address.repository.js';
import { priceCart } from './pricing.js';
import * as repo from './checkout.repository.js';

export interface CatalogLookup {
  findMerchantById(id: string): Promise<MerchantRow | null>;
}

export interface CheckoutPort {
  initiate(input: InitiatePaymentInput): Promise<InitiatePaymentResult>;
}

export interface CheckoutAddressInput {
  label: string;
  latitude: number;
  longitude: number;
  landmark?: string;
}

export interface CheckoutInput {
  address: CheckoutAddressInput;
  paymentMethod: PaymentMethod;
  payerPhone: string;
  idempotencyKey: string;
}

export type CheckoutOutcome =
  | { ok: true; orderId: string; orderNumber: string; paymentStatus: string }
  | { ok: false; reason: 'MERCHANT_NOT_FOUND' | 'CART_EMPTY' | 'CART_HAS_ISSUES' }
  | {
      ok: false;
      reason: 'PAYMENT_FAILED';
      errorCode: string;
      errorMessage: string;
      orderId: string;
      orderNumber: string;
    };

export function createCheckoutService(deps: {
  catalog: CatalogLookup;
  cart: CartService;
  geo: GeoPort;
  payment: CheckoutPort;
}) {
  async function checkout(
    userId: string,
    merchantId: string,
    input: CheckoutInput
  ): Promise<CheckoutOutcome> {
    const existing = await repo.findCheckoutByIdempotencyKey(input.idempotencyKey);
    if (existing) {
      return {
        ok: true,
        orderId: existing.orderId,
        orderNumber: existing.orderNumber,
        paymentStatus: existing.paymentStatus,
      };
    }

    const merchant = await deps.catalog.findMerchantById(merchantId);
    if (!merchant) return { ok: false, reason: 'MERCHANT_NOT_FOUND' };

    const cartView = await deps.cart.getCart(userId, merchantId);
    if (!cartView || cartView.items.length === 0) return { ok: false, reason: 'CART_EMPTY' };
    if (cartView.issues.length > 0) return { ok: false, reason: 'CART_HAS_ISSUES' };

    const address = await createAddress({
      userId,
      label: input.address.label,
      latitude: input.address.latitude,
      longitude: input.address.longitude,
      ...(input.address.landmark !== undefined ? { landmark: input.address.landmark } : {}),
    });

    const distanceKm =
      deps.geo.distanceMeters(
        { latitude: merchant.latitude, longitude: merchant.longitude },
        { latitude: address.latitude, longitude: address.longitude }
      ) / 1000;

    const feeSchedule = await findActiveFeeSchedule(merchant.cityId, merchant.vertical as Vertical);

    const pricing = priceCart({
      items: cartView.items.map((item) => ({
        unitPriceMinor: item.unitPriceMinor,
        quantity: item.quantity,
      })),
      currency: cartView.currency,
      feeSchedule: feeSchedule ?? { baseFeeMinor: 0n, perKmFeeMinor: 0n, serviceFeeBps: 0 },
      distanceKm,
    });

    const created = await repo.createCheckout({
      customerId: userId,
      merchantId,
      vertical: merchant.vertical as Vertical,
      addressId: address.id,
      subtotalMinor: pricing.subtotalMinor,
      deliveryFeeMinor: pricing.deliveryFeeMinor,
      serviceFeeMinor: pricing.serviceFeeMinor,
      discountMinor: pricing.discountMinor,
      totalMinor: pricing.totalMinor,
      currency: pricing.currency,
      items: cartView.items.map((item) => ({
        productId: item.productId,
        nameSnapshot: item.name,
        quantity: item.quantity,
        unitPriceMinor: item.unitPriceMinor,
      })),
      paymentMethod: input.paymentMethod,
      idempotencyKey: input.idempotencyKey,
    });

    // The order now exists and owns these items; the cart's job is done,
    // whether or not payment goes on to succeed. A failed payment is
    // resolved by the customer starting a fresh checkout, not by resurrecting
    // this cart.
    await deps.cart.clearCart(userId, merchantId);

    const initiateResult = await deps.payment.initiate({
      amountMinor: pricing.totalMinor,
      currency: pricing.currency,
      method: input.paymentMethod,
      payerPhone: input.payerPhone,
      idempotencyKey: input.idempotencyKey,
    });

    if (initiateResult.status === 'PENDING') {
      await recordProviderRef(created.paymentIntentId, initiateResult.providerRef);
      return {
        ok: true,
        orderId: created.orderId,
        orderNumber: created.orderNumber,
        paymentStatus: 'PENDING',
      };
    }

    await applyInitiateFailure({
      paymentIntentId: created.paymentIntentId,
      errorCode: initiateResult.errorCode,
      errorMessage: initiateResult.errorMessage,
    });

    return {
      ok: false,
      reason: 'PAYMENT_FAILED',
      errorCode: initiateResult.errorCode,
      errorMessage: initiateResult.errorMessage,
      orderId: created.orderId,
      orderNumber: created.orderNumber,
    };
  }

  return { checkout };
}

export type CheckoutService = ReturnType<typeof createCheckoutService>;
