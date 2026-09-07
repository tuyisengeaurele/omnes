/**
 * End-to-end checkout tests: real Express app, real Postgres. Covers the
 * guarantees checkout.service.ts and checkout.repository.ts exist for -
 * idempotent double submit, a payment that fails synchronously still
 * producing an order, and the plain input-validation failures.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../../app.js';
import { getConfig } from '../../platform/config.js';
import { getLogger } from '../../platform/logger.js';
import { getDb, disconnectDb } from '../../platform/db.js';
import type { SendSmsInput, SendSmsResult, SmsPort } from '../../adapters/sms/index.js';

function createSpySmsPort() {
  const messages: SendSmsInput[] = [];
  const port: SmsPort = {
    send(input: SendSmsInput): Promise<SendSmsResult> {
      messages.push(input);
      return Promise.resolve({ ok: true, providerRef: 'test' });
    },
  };
  return {
    port,
    lastCodeFor(phoneE164: string): string {
      const match = [...messages].reverse().find((m) => m.to === phoneE164);
      if (!match) throw new Error(`no sms sent to ${phoneE164}`);
      const code = /\d{4,10}/.exec(match.body);
      if (!code) throw new Error(`no code found in sms body: ${match.body}`);
      return code[0];
    },
  };
}

const config = getConfig();
const logger = getLogger();

let phoneCounter = 0;
function uniquePhone(suffix = ''): string {
  phoneCounter += 1;
  const base = 83000000 + phoneCounter;
  return `+2507${String(base)
    .padStart(8, '0')
    .slice(0, suffix ? 4 : 8)}${suffix}`;
}

async function loginAgentWithOwnApp(phoneE164: string) {
  const sms = createSpySmsPort();
  const app = createApp({ config, logger, smsPort: sms.port });
  const agent = request.agent(app);
  await agent.post('/api/auth/login/request-otp').send({ phoneE164 });
  const code = sms.lastCodeFor(phoneE164);
  const res = await agent.post('/api/auth/login/verify').send({ phoneE164, code });
  return { agent, app, csrfToken: res.body.csrfToken as string };
}

describe('checkout routes', () => {
  let cityId: string;
  let zoneId: string;
  let merchantId: string;
  const usedPhones: string[] = [];
  const createdMerchantIds: string[] = [];

  function freshPhone(suffix = ''): string {
    const phone = uniquePhone(suffix);
    usedPhones.push(phone);
    return phone;
  }

  async function createOwnershipTarget(): Promise<string> {
    const phone = freshPhone();
    const db = getDb();
    const user = await db.user.create({
      data: { phoneE164: phone, displayName: 'Prospective Owner' },
    });
    return user.id;
  }

  async function createCustomer(suffix = ''): Promise<string> {
    const phone = freshPhone(suffix);
    const db = getDb();
    const user = await db.user.create({ data: { phoneE164: phone, displayName: 'Test Customer' } });
    await db.userRole.create({ data: { userId: user.id, role: 'CUSTOMER' } });
    return phone;
  }

  async function createProduct(priceMinor = 1000n) {
    const db = getDb();
    return db.product.create({
      data: {
        merchantId,
        name: `Checkout Test Product ${Date.now()}-${Math.random()}`,
        priceMinor,
        currency: 'RWF',
        isAvailable: true,
        stockCount: null,
      },
    });
  }

  beforeAll(async () => {
    const db = getDb();
    const city = await db.city.create({
      data: {
        code: `CO${Date.now()}`,
        name: 'Checkout Test City',
        countryCode: 'RW',
        currency: 'RWF',
        timezone: 'Africa/Kigali',
        activeVerticals: ['FOOD'],
      },
    });
    cityId = city.id;
    const zone = await db.zone.create({
      data: {
        cityId,
        name: 'Checkout Test Zone',
        polygon: { type: 'Point', coordinates: [30.0619, -1.9441] },
        deliveryRadiusM: 5000,
      },
    });
    zoneId = zone.id;
    await db.feeSchedule.create({
      data: {
        cityId,
        vertical: 'FOOD',
        baseFeeMinor: 500n,
        perKmFeeMinor: 200n,
        serviceFeeBps: 500,
        effectiveFrom: new Date(Date.now() - 1000),
      },
    });

    const opsPhone = freshPhone();
    const opsUser = await db.user.create({ data: { phoneE164: opsPhone, displayName: 'Ops' } });
    await db.userRole.create({ data: { userId: opsUser.id, role: 'OPS' } });
    const { agent, csrfToken } = await loginAgentWithOwnApp(opsPhone);

    const merchantRes = await agent
      .post('/api/catalog/merchants')
      .set('X-CSRF-Token', csrfToken)
      .send({
        name: 'Checkout Test Merchant',
        vertical: 'FOOD',
        cityId,
        zoneId,
        latitude: -1.9441,
        longitude: 30.0619,
        ownerUserId: await createOwnershipTarget(),
      });
    merchantId = merchantRes.body.merchant.id as string;
    createdMerchantIds.push(merchantId);
  });

  afterAll(async () => {
    const db = getDb();
    await db.orderEvent.deleteMany({
      where: { order: { merchantId: { in: createdMerchantIds } } },
    });
    await db.orderItem.deleteMany({ where: { order: { merchantId: { in: createdMerchantIds } } } });
    await db.paymentAttempt.deleteMany({
      where: { intent: { order: { merchantId: { in: createdMerchantIds } } } },
    });
    await db.paymentIntent.deleteMany({
      where: { order: { merchantId: { in: createdMerchantIds } } },
    });
    await db.order.deleteMany({ where: { merchantId: { in: createdMerchantIds } } });
    await db.cartItem.deleteMany({});
    await db.cart.deleteMany({});
    await db.product.deleteMany({ where: { merchantId: { in: createdMerchantIds } } });
    await db.merchantProfile.deleteMany({ where: { merchantId: { in: createdMerchantIds } } });
    await db.merchant.deleteMany({ where: { id: { in: createdMerchantIds } } });
    await db.feeSchedule.deleteMany({ where: { cityId } });
    for (const phone of usedPhones) {
      const user = await db.user.findUnique({ where: { phoneE164: phone } });
      if (user) {
        await db.address.deleteMany({ where: { userId: user.id } });
        await db.refreshToken.deleteMany({ where: { userId: user.id } });
        await db.userRole.deleteMany({ where: { userId: user.id } });
        await db.user.delete({ where: { id: user.id } });
      }
      await db.otpChallenge.deleteMany({ where: { phoneE164: phone } });
    }
    await db.zone.delete({ where: { id: zoneId } });
    await db.city.delete({ where: { id: cityId } });
    await disconnectDb();
  });

  function checkoutBody(payerPhone: string, overrides: Record<string, unknown> = {}) {
    return {
      address: { label: 'Home', latitude: -1.95, longitude: 30.07 },
      paymentMethod: 'MTN_MOMO',
      payerPhone,
      idempotencyKey: randomUUID(),
      ...overrides,
    };
  }

  it('rejects a checkout request with no CSRF token', async () => {
    const phone = await createCustomer();
    const { agent } = await loginAgentWithOwnApp(phone);

    await agent.post(`/api/checkout/${merchantId}`).send(checkoutBody(phone)).expect(403);
  });

  it('rejects checkout for an empty cart', async () => {
    const phone = await createCustomer();
    const { agent, csrfToken } = await loginAgentWithOwnApp(phone);

    const res = await agent
      .post(`/api/checkout/${merchantId}`)
      .set('X-CSRF-Token', csrfToken)
      .send(checkoutBody(phone))
      .expect(400);

    expect(res.body.error.code).toBe('CART_EMPTY');
  });

  it('rejects checkout for a merchant that does not exist', async () => {
    const phone = await createCustomer();
    const { agent, csrfToken } = await loginAgentWithOwnApp(phone);

    await agent
      .post(`/api/checkout/${randomUUID()}`)
      .set('X-CSRF-Token', csrfToken)
      .send(checkoutBody(phone))
      .expect(404);
  });

  it('creates an order and starts a pending payment, twice with the same key returns the same order', async () => {
    const product = await createProduct(1500n);
    const phone = await createCustomer();
    const { agent, csrfToken } = await loginAgentWithOwnApp(phone);

    await agent
      .post(`/api/cart/${merchantId}/items`)
      .set('X-CSRF-Token', csrfToken)
      .send({ productId: product.id, quantity: 2 })
      .expect(201);

    const body = checkoutBody(phone);

    const first = await agent
      .post(`/api/checkout/${merchantId}`)
      .set('X-CSRF-Token', csrfToken)
      .send(body)
      .expect(201);

    expect(first.body.orderId).toBeDefined();
    expect(first.body.paymentStatus).toBe('PENDING');

    const db = getDb();
    const order = await db.order.findUnique({ where: { id: first.body.orderId as string } });
    expect(order?.status).toBe('PENDING_PAYMENT');
    expect(order?.subtotalMinor.toString()).toBe('3000');
    // Delivery fee depends on the haversine distance to the address, which
    // this test does not pin down exactly - only that fees were actually
    // applied on top of the subtotal, using the fee schedule from beforeAll.
    expect(order?.totalMinor ?? 0n).toBeGreaterThan(order?.subtotalMinor ?? 0n);

    const cartAfter = await agent.get(`/api/cart/${merchantId}`).expect(200);
    expect(cartAfter.body.items).toHaveLength(0);

    // Retried with the same idempotency key: same order, not a second one.
    const second = await agent
      .post(`/api/checkout/${merchantId}`)
      .set('X-CSRF-Token', csrfToken)
      .send(body)
      .expect(201);

    expect(second.body.orderId).toBe(first.body.orderId);

    const customer = await db.user.findUniqueOrThrow({ where: { phoneE164: phone } });
    const orderCount = await db.order.count({ where: { customerId: customer.id } });
    expect(orderCount).toBe(1);
  });

  it('still creates an order when the payment fails synchronously, and cancels it', async () => {
    const product = await createProduct(1000n);
    const phone = await createCustomer('0000'); // magic suffix: mock adapter rejects synchronously
    const { agent, csrfToken } = await loginAgentWithOwnApp(phone);

    await agent
      .post(`/api/cart/${merchantId}/items`)
      .set('X-CSRF-Token', csrfToken)
      .send({ productId: product.id, quantity: 1 })
      .expect(201);

    const res = await agent
      .post(`/api/checkout/${merchantId}`)
      .set('X-CSRF-Token', csrfToken)
      .send(checkoutBody(phone))
      .expect(402);

    expect(res.body.error.code).toBe('INSUFFICIENT_FUNDS');
    expect(res.body.orderId).toBeDefined();

    const db = getDb();
    const order = await db.order.findUnique({ where: { id: res.body.orderId as string } });
    expect(order?.status).toBe('CANCELLED');
  });
});
