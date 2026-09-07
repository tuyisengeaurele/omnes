/**
 * The pricing engine. A pure function: no database, no clock, no I/O. Every
 * amount is a BigInt of minor currency units, matching the schema, so there
 * is no floating-point money anywhere in this file - see
 * docs/build-plan.md section 1.3 for why that matters.
 *
 * This is the single place order totals get computed. The cart service and
 * checkout (a later phase) both call this rather than each growing their
 * own copy of "how do we add up a cart," which is exactly the kind of
 * money-touching logic the build plan singles out for heavy unit test
 * coverage over anything relying on manual QA.
 */

export interface PricingLineItem {
  unitPriceMinor: bigint;
  quantity: number;
}

export interface FeeScheduleInput {
  baseFeeMinor: bigint;
  perKmFeeMinor: bigint;
  /** Basis points: 500 = 5%. */
  serviceFeeBps: number;
}

export interface PriceCartInput {
  items: PricingLineItem[];
  currency: string;
  feeSchedule: FeeScheduleInput;
  /** Delivery distance, when known. Omitted or non-positive means base fee only. */
  distanceKm?: number;
  /** Never negative; clamped so a discount cannot push the total below zero. */
  discountMinor?: bigint;
}

export interface PriceBreakdown {
  subtotalMinor: bigint;
  deliveryFeeMinor: bigint;
  serviceFeeMinor: bigint;
  discountMinor: bigint;
  totalMinor: bigint;
  currency: string;
}

function computeSubtotal(items: PricingLineItem[]): bigint {
  return items.reduce((sum, item) => sum + item.unitPriceMinor * BigInt(item.quantity), 0n);
}

function computeDeliveryFee(feeSchedule: FeeScheduleInput, distanceKm: number | undefined): bigint {
  if (distanceKm === undefined || distanceKm <= 0) return feeSchedule.baseFeeMinor;

  // distanceKm is a float and perKmFeeMinor is an integer amount of minor
  // units; the product is rounded to the nearest whole minor unit rather
  // than truncated, so a distance that is not an exact number of km does
  // not silently undercharge by a fraction of a unit on every order.
  const distanceComponent = BigInt(Math.round(distanceKm * Number(feeSchedule.perKmFeeMinor)));
  return feeSchedule.baseFeeMinor + distanceComponent;
}

/**
 * Round-half-up in pure BigInt arithmetic, so this never touches floating
 * point: (subtotal * bps + half the divisor) / divisor, using integer
 * division to truncate after the rounding term has already been added.
 */
function computeServiceFee(subtotalMinor: bigint, serviceFeeBps: number): bigint {
  const bps = BigInt(serviceFeeBps);
  return (subtotalMinor * bps + 5000n) / 10000n;
}

export function priceCart(input: PriceCartInput): PriceBreakdown {
  const subtotalMinor = computeSubtotal(input.items);
  const deliveryFeeMinor = computeDeliveryFee(input.feeSchedule, input.distanceKm);
  const serviceFeeMinor = computeServiceFee(subtotalMinor, input.feeSchedule.serviceFeeBps);

  const preDiscountTotal = subtotalMinor + deliveryFeeMinor + serviceFeeMinor;
  const requestedDiscount = input.discountMinor ?? 0n;
  // Clamped both ways: never negative (a caller cannot pass a negative
  // discountMinor to inflate the total), and never larger than what it
  // would discount away entirely, so the total can never go below zero.
  const discountMinor =
    requestedDiscount < 0n
      ? 0n
      : requestedDiscount > preDiscountTotal
        ? preDiscountTotal
        : requestedDiscount;

  const totalMinor = preDiscountTotal - discountMinor;

  return {
    subtotalMinor,
    deliveryFeeMinor,
    serviceFeeMinor,
    discountMinor,
    totalMinor,
    currency: input.currency,
  };
}
