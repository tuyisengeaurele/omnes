/**
 * End-to-end payment webhook tests: real Express app, real Postgres. Covers
 * the shared-secret guard, the state transition into PAID plus the ledger
 * postings that follow it, and that a redelivered webhook is a no-op rather
 * than a double-posted ledger entry.
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
function uniquePhone(): string {
  phoneCounter += 1;
  return `+2507${String(84000000 + phoneCounter).padStart(8, '0')}`;
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

describe('payment webhook route', () => {
  let cityId: string;
  let zoneId: string;
  let merchantId: string;
  const usedPhones: string[] = [];
  const createdMerchantIds: string[] = [];
  const createdOrderIds: string[] = [];
  let app: ReturnType<typeof createApp>;

  function freshPhone(): string {
    const phone = uniquePhone();
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

  async function createCustomer(): Promise<string> {
    const phone = freshPhone();
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
        name: `Webhook Test Product ${Date.now()}-${Math.random()}`,
        priceMinor,
        currency: 'RWF',
        isAvailable: true,
        stockCount: null,
      },
    });
  }

  /** Runs a full checkout via HTTP and returns the created order plus the providerRef the mock adapter assigned it. */
  async function checkoutPendingOrder(): Promise<{ orderId: string; providerRef: string }> {
    const product = await createProduct(2000n);
    const phone = await createCustomer();
    const { agent, csrfToken } = await loginAgentWithOwnApp(phone);

    await agent
      .post(`/api/cart/${merchantId}/items`)
      .set('X-CSRF-Token', csrfToken)
      .send({ productId: product.id, quantity: 1 })
      .expect(201);

    const res = await agent
      .post(`/api/checkout/${merchantId}`)
      .set('X-CSRF-Token', csrfToken)
      .send({
        address: { label: 'Home', latitude: -1.95, longitude: 30.07 },
        paymentMethod: 'MTN_MOMO',
        payerPhone: phone,
        idempotencyKey: randomUUID(),
      })
      .expect(201);

    const orderId = res.body.orderId as string;
    createdOrderIds.push(orderId);
    const db = getDb();
    const intent = await db.paymentIntent.findFirstOrThrow({ where: { orderId } });
    if (!intent.providerRef) throw new Error('expected a providerRef on a pending payment intent');
    return { orderId, providerRef: intent.providerRef };
  }

  beforeAll(async () => {
    const db = getDb();
    const city = await db.city.create({
      data: {
        code: `WH${Date.now()}`,
        name: 'Webhook Test City',
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
        name: 'Webhook Test Zone',
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
        name: 'Webhook Test Merchant',
        vertical: 'FOOD',
        cityId,
        zoneId,
        latitude: -1.9441,
        longitude: 30.0619,
        ownerUserId: await createOwnershipTarget(),
      });
    merchantId = merchantRes.body.merchant.id as string;
    createdMerchantIds.push(merchantId);

    app = createApp({ config, logger });
  });

  afterAll(async () => {
    const db = getDb();
    const ledgerReferences = createdOrderIds.flatMap((id) => [
      `order-payment:${id}`,
      `order-commission:${id}`,
    ]);
    // LedgerEntry.txn has onDelete: Cascade, so removing the transaction
    // also removes both its entries - the merchant side and the platform
    // side - without needing a separate entry delete.
    if (ledgerReferences.length > 0) {
      await db.ledgerTxn.deleteMany({ where: { reference: { in: ledgerReferences } } });
    }
    await db.ledgerAccount.deleteMany({
      where: { ownerType: 'MERCHANT', ownerId: { in: createdMerchantIds } },
    });
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

  it('rejects a callback with no secret header', async () => {
    const { providerRef } = await checkoutPendingOrder();

    await request(app)
      .post('/api/payments/webhooks/mock')
      .send({ providerRef, status: 'SUCCEEDED' })
      .expect(403);
  });

  it('rejects a callback with the wrong secret', async () => {
    const { providerRef } = await checkoutPendingOrder();

    await request(app)
      .post('/api/payments/webhooks/mock')
      .set('X-Webhook-Secret', 'not-the-right-secret')
      .send({ providerRef, status: 'SUCCEEDED' })
      .expect(403);
  });

  it('returns not found for a providerRef with no matching payment intent', async () => {
    await request(app)
      .post('/api/payments/webhooks/mock')
      .set('X-Webhook-Secret', config.PAYMENT_WEBHOOK_SECRET)
      .send({ providerRef: `mock-momo-${randomUUID()}`, status: 'SUCCEEDED' })
      .expect(404);
  });

  it('marks the order paid and posts the ledger on success, and is a no-op if redelivered', async () => {
    const { orderId, providerRef } = await checkoutPendingOrder();

    await request(app)
      .post('/api/payments/webhooks/mock')
      .set('X-Webhook-Secret', config.PAYMENT_WEBHOOK_SECRET)
      .send({ providerRef, status: 'SUCCEEDED' })
      .expect(200, { received: true });

    const db = getDb();
    const order = await db.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe('PAID');

    const paymentTxns = await db.ledgerTxn.findMany({
      where: { reference: `order-payment:${orderId}` },
    });
    expect(paymentTxns).toHaveLength(1);

    // Redelivered: applyWebhook finds the intent already terminal and
    // no-ops, so the response still reports success but nothing changes.
    await request(app)
      .post('/api/payments/webhooks/mock')
      .set('X-Webhook-Secret', config.PAYMENT_WEBHOOK_SECRET)
      .send({ providerRef, status: 'SUCCEEDED' })
      .expect(200, { received: true });

    const paymentTxnsAfterRetry = await db.ledgerTxn.findMany({
      where: { reference: `order-payment:${orderId}` },
    });
    expect(paymentTxnsAfterRetry).toHaveLength(1);
  });

  it('cancels the order on a failed callback and posts no ledger entry', async () => {
    const { orderId, providerRef } = await checkoutPendingOrder();

    await request(app)
      .post('/api/payments/webhooks/mock')
      .set('X-Webhook-Secret', config.PAYMENT_WEBHOOK_SECRET)
      .send({
        providerRef,
        status: 'FAILED',
        errorCode: 'DECLINED',
        errorMessage: 'The customer declined the request on their phone.',
      })
      .expect(200, { received: true });

    const db = getDb();
    const order = await db.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe('CANCELLED');

    const paymentTxns = await db.ledgerTxn.findMany({
      where: { reference: `order-payment:${orderId}` },
    });
    expect(paymentTxns).toHaveLength(0);
  });
});
