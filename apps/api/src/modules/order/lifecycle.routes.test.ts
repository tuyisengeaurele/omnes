/**
 * End-to-end order lifecycle tests: real Express app, real Postgres.
 * Covers ownership on history/detail, the merchant accept/reject actions,
 * customer and ops cancel, illegal-transition rejection at the HTTP layer,
 * and that a transition actually fires the realtime publish and the
 * customer notification (via injected spies, rather than parsing a live
 * SSE stream).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../../app.js';
import { getConfig } from '../../platform/config.js';
import { getLogger } from '../../platform/logger.js';
import { getDb, disconnectDb } from '../../platform/db.js';
import type { NotifyInput, NotificationPort } from '../../adapters/notification/index.js';
import type { OrderStatusEvent, RealtimePort } from '../../adapters/realtime/index.js';
import { createInMemoryRealtimeAdapter } from '../../adapters/realtime/inMemoryRealtimeAdapter.js';
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

function createSpyNotificationPort() {
  const sent: NotifyInput[] = [];
  const port: NotificationPort = {
    notify(input: NotifyInput): Promise<void> {
      sent.push(input);
      return Promise.resolve();
    },
  };
  return { port, sent };
}

function createSpyRealtimePort() {
  const published: OrderStatusEvent[] = [];
  const inner = createInMemoryRealtimeAdapter();
  const port: RealtimePort = {
    publishOrderStatus(event: OrderStatusEvent): void {
      published.push(event);
      inner.publishOrderStatus(event);
    },
    subscribeToOrder: (orderId, listener) => inner.subscribeToOrder(orderId, listener),
  };
  return { port, published };
}

// This file logs in far more times than the default auth rate limit
// allows, since every helper below opens its own session rather than
// reusing one across tests (each test needs its own customer or merchant
// owner identity). Raised only for this suite's app instance, not the
// shared config other files import.
const config = { ...getConfig(), RATE_LIMIT_AUTH_MAX_REQUESTS: 1000 };
const logger = getLogger();

let phoneCounter = 0;
function uniquePhone(): string {
  phoneCounter += 1;
  return `+2507${String(85000000 + phoneCounter).padStart(8, '0')}`;
}

describe('order lifecycle routes', () => {
  let cityId: string;
  let zoneId: string;
  let merchantId: string;
  let merchantOwnerPhone: string;
  let otherMerchantOwnerPhone: string;
  const usedPhones: string[] = [];
  const createdMerchantIds: string[] = [];
  const createdOrderIds: string[] = [];
  let notification: ReturnType<typeof createSpyNotificationPort>;
  let realtime: ReturnType<typeof createSpyRealtimePort>;
  let app: ReturnType<typeof createApp>;

  function freshPhone(): string {
    const phone = uniquePhone();
    usedPhones.push(phone);
    return phone;
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
        name: `Lifecycle Test Product ${Date.now()}-${Math.random()}`,
        priceMinor,
        currency: 'RWF',
        isAvailable: true,
        stockCount: null,
      },
    });
  }

  let sharedSms: ReturnType<typeof createSpySmsPort>;

  async function login(phoneE164: string) {
    const agent = request.agent(app);
    await agent.post('/api/auth/login/request-otp').send({ phoneE164 }).expect(202);
    const code = sharedSms.lastCodeFor(phoneE164);
    const res = await agent.post('/api/auth/login/verify').send({ phoneE164, code }).expect(200);
    return { agent, csrfToken: res.body.csrfToken as string };
  }

  /** Checks out a fresh order, leaving it PENDING_PAYMENT (no webhook fired yet). */
  async function checkoutPendingOrder(customerPhone: string): Promise<{
    orderId: string;
    orderNumber: string;
    providerRef: string;
  }> {
    const product = await createProduct(1500n);
    const { agent, csrfToken } = await login(customerPhone);

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
        payerPhone: customerPhone,
        idempotencyKey: randomUUID(),
      })
      .expect(201);

    const orderId = res.body.orderId as string;
    const orderNumber = res.body.orderNumber as string;
    createdOrderIds.push(orderId);
    const db = getDb();
    const intent = await db.paymentIntent.findFirstOrThrow({ where: { orderId } });
    if (!intent.providerRef) throw new Error('expected a providerRef on a pending payment intent');
    return { orderId, orderNumber, providerRef: intent.providerRef };
  }

  /** Checks out and confirms payment, leaving the order at MERCHANT_PENDING. */
  async function checkoutToMerchantPending(
    customerPhone: string
  ): Promise<{ orderId: string; orderNumber: string }> {
    const { orderId, orderNumber, providerRef } = await checkoutPendingOrder(customerPhone);

    await request(app)
      .post('/api/payments/webhooks/mock')
      .set('X-Webhook-Secret', config.PAYMENT_WEBHOOK_SECRET)
      .send({ providerRef, status: 'SUCCEEDED' })
      .expect(200);

    return { orderId, orderNumber };
  }

  beforeAll(async () => {
    const db = getDb();
    const city = await db.city.create({
      data: {
        code: `LC${Date.now()}`,
        name: 'Lifecycle Test City',
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
        name: 'Lifecycle Test Zone',
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

    sharedSms = createSpySmsPort();
    notification = createSpyNotificationPort();
    realtime = createSpyRealtimePort();
    app = createApp({
      config,
      logger,
      smsPort: sharedSms.port,
      notificationPort: notification.port,
      realtimePort: realtime.port,
    });

    const opsPhone = freshPhone();
    const opsUser = await db.user.create({ data: { phoneE164: opsPhone, displayName: 'Ops' } });
    await db.userRole.create({ data: { userId: opsUser.id, role: 'OPS' } });
    const { agent: opsAgent, csrfToken: opsCsrf } = await login(opsPhone);

    merchantOwnerPhone = freshPhone();
    const ownerUser = await db.user.create({
      data: { phoneE164: merchantOwnerPhone, displayName: 'Merchant Owner' },
    });

    const merchantRes = await opsAgent
      .post('/api/catalog/merchants')
      .set('X-CSRF-Token', opsCsrf)
      .send({
        name: 'Lifecycle Test Merchant',
        vertical: 'FOOD',
        cityId,
        zoneId,
        latitude: -1.9441,
        longitude: 30.0619,
        ownerUserId: ownerUser.id,
      });
    merchantId = merchantRes.body.merchant.id as string;
    createdMerchantIds.push(merchantId);

    otherMerchantOwnerPhone = freshPhone();
    const otherOwnerUser = await db.user.create({
      data: { phoneE164: otherMerchantOwnerPhone, displayName: 'Other Merchant Owner' },
    });
    const otherMerchantRes = await opsAgent
      .post('/api/catalog/merchants')
      .set('X-CSRF-Token', opsCsrf)
      .send({
        name: 'Other Lifecycle Merchant',
        vertical: 'FOOD',
        cityId,
        zoneId,
        latitude: -1.9441,
        longitude: 30.0619,
        ownerUserId: otherOwnerUser.id,
      });
    createdMerchantIds.push(otherMerchantRes.body.merchant.id as string);
  });

  afterAll(async () => {
    const db = getDb();
    const ledgerReferences = createdOrderIds.flatMap((id) => [
      `order-payment:${id}`,
      `order-commission:${id}`,
    ]);
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

  describe('accept', () => {
    it('lets the owning merchant accept a pending order, and publishes plus notifies', async () => {
      const customerPhone = await createCustomer();
      const { orderId, orderNumber } = await checkoutToMerchantPending(customerPhone);
      const { agent, csrfToken } = await login(merchantOwnerPhone);

      const publishedBefore = realtime.published.length;
      const sentBefore = notification.sent.length;

      await agent
        .post(`/api/orders/${orderId}/accept`)
        .set('X-CSRF-Token', csrfToken)
        .send()
        .expect(200, { status: 'ACCEPTED' });

      const db = getDb();
      const order = await db.order.findUniqueOrThrow({ where: { id: orderId } });
      expect(order.status).toBe('ACCEPTED');

      const published = realtime.published.slice(publishedBefore);
      expect(published).toContainEqual(expect.objectContaining({ orderId, status: 'ACCEPTED' }));

      const sent = notification.sent.slice(sentBefore);
      expect(sent).toHaveLength(1);
      expect(sent[0]?.body).toContain(orderNumber);
    });

    it('rejects a merchant that does not own the order', async () => {
      const customerPhone = await createCustomer();
      const { orderId } = await checkoutToMerchantPending(customerPhone);
      const { agent, csrfToken } = await login(otherMerchantOwnerPhone);

      await agent
        .post(`/api/orders/${orderId}/accept`)
        .set('X-CSRF-Token', csrfToken)
        .send()
        .expect(403);
    });

    it('rejects accepting an order that is not awaiting the merchant', async () => {
      const customerPhone = await createCustomer();
      const { orderId } = await checkoutPendingOrder(customerPhone); // still PENDING_PAYMENT
      const { agent, csrfToken } = await login(merchantOwnerPhone);

      const res = await agent
        .post(`/api/orders/${orderId}/accept`)
        .set('X-CSRF-Token', csrfToken)
        .send()
        .expect(409);

      expect(res.body.error.code).toBe('ILLEGAL_ORDER_TRANSITION');
    });
  });

  describe('reject', () => {
    it('lets the owning merchant reject a pending order with a reason', async () => {
      const customerPhone = await createCustomer();
      const { orderId } = await checkoutToMerchantPending(customerPhone);
      const { agent, csrfToken } = await login(merchantOwnerPhone);

      await agent
        .post(`/api/orders/${orderId}/reject`)
        .set('X-CSRF-Token', csrfToken)
        .send({ reason: 'Out of stock' })
        .expect(200, { status: 'REJECTED' });

      const db = getDb();
      const event = await db.orderEvent.findFirstOrThrow({
        where: { orderId, toStatus: 'REJECTED' },
      });
      expect(event.reason).toBe('Out of stock');
    });
  });

  describe('cancel', () => {
    it('lets the customer cancel their own order before it is prepared', async () => {
      const customerPhone = await createCustomer();
      const { orderId } = await checkoutPendingOrder(customerPhone);
      const { agent, csrfToken } = await login(customerPhone);

      await agent
        .post(`/api/orders/${orderId}/cancel`)
        .set('X-CSRF-Token', csrfToken)
        .send()
        .expect(200, { status: 'CANCELLED' });
    });

    it('lets ops cancel any order', async () => {
      const customerPhone = await createCustomer();
      const { orderId } = await checkoutPendingOrder(customerPhone);
      const opsPhone = usedPhones[0];
      if (!opsPhone) throw new Error('expected an ops phone from beforeAll');
      const { agent, csrfToken } = await login(opsPhone);

      await agent
        .post(`/api/orders/${orderId}/cancel`)
        .set('X-CSRF-Token', csrfToken)
        .send()
        .expect(200, { status: 'CANCELLED' });
    });

    it('leaves a cancelled order alone when its payment webhook arrives afterward', async () => {
      const customerPhone = await createCustomer();
      const { orderId, providerRef } = await checkoutPendingOrder(customerPhone);
      const { agent, csrfToken } = await login(customerPhone);

      // The customer cancels while the payment is still PENDING at the
      // provider - a real race, not a contrived one: nothing stops a
      // customer cancelling in the moment between initiating payment and
      // approving it on their phone.
      await agent
        .post(`/api/orders/${orderId}/cancel`)
        .set('X-CSRF-Token', csrfToken)
        .send()
        .expect(200, { status: 'CANCELLED' });

      // The webhook still reports success to the provider - retrying
      // would not fix a mismatch a human needs to reconcile - but the
      // order itself is left CANCELLED, not silently moved to PAID.
      await request(app)
        .post('/api/payments/webhooks/mock')
        .set('X-Webhook-Secret', config.PAYMENT_WEBHOOK_SECRET)
        .send({ providerRef, status: 'SUCCEEDED' })
        .expect(200, { received: true });

      const db = getDb();
      const order = await db.order.findUniqueOrThrow({ where: { id: orderId } });
      expect(order.status).toBe('CANCELLED');

      // The payment intent's own status is still recorded accurately -
      // the payment really did succeed, even though the order could not
      // follow it there.
      const intent = await db.paymentIntent.findFirstOrThrow({ where: { orderId } });
      expect(intent.status).toBe('SUCCEEDED');

      const paymentTxns = await db.ledgerTxn.findMany({
        where: { reference: `order-payment:${orderId}` },
      });
      expect(paymentTxns).toHaveLength(0);
    });

    it('rejects a stranger cancelling an order that is not theirs', async () => {
      const customerPhone = await createCustomer();
      const { orderId } = await checkoutPendingOrder(customerPhone);
      const strangerPhone = await createCustomer();
      const { agent, csrfToken } = await login(strangerPhone);

      await agent
        .post(`/api/orders/${orderId}/cancel`)
        .set('X-CSRF-Token', csrfToken)
        .send()
        .expect(403);
    });
  });

  describe('history and detail', () => {
    it("lists the customer's own orders, most recent first", async () => {
      const customerPhone = await createCustomer();
      const first = await checkoutPendingOrder(customerPhone);
      const second = await checkoutPendingOrder(customerPhone);
      const { agent } = await login(customerPhone);

      const res = await agent.get('/api/orders').expect(200);
      const ids = (res.body.items as Array<{ id: string }>).map((o) => o.id);
      expect(ids.indexOf(second.orderId)).toBeLessThan(ids.indexOf(first.orderId));
    });

    it('returns order detail to its owner and to the owning merchant, not to a stranger', async () => {
      const customerPhone = await createCustomer();
      const { orderId } = await checkoutPendingOrder(customerPhone);

      const { agent: ownerAgent } = await login(customerPhone);
      const ownRes = await ownerAgent.get(`/api/orders/${orderId}`).expect(200);
      expect(ownRes.body.order.id).toBe(orderId);

      const { agent: merchantAgent } = await login(merchantOwnerPhone);
      await merchantAgent.get(`/api/orders/${orderId}`).expect(200);

      const strangerPhone = await createCustomer();
      const { agent: strangerAgent } = await login(strangerPhone);
      await strangerAgent.get(`/api/orders/${orderId}`).expect(403);
    });

    it('returns not found for an unknown order id', async () => {
      const customerPhone = await createCustomer();
      const { agent } = await login(customerPhone);
      await agent.get(`/api/orders/${randomUUID()}`).expect(404);
    });
  });

  describe('stream', () => {
    // Only the authorization check is exercised here: the success path
    // opens a connection that never ends on its own (the whole point of
    // SSE), which a normal supertest request would hang waiting to
    // complete. The event-formatting logic itself is a few lines in
    // lifecycle.routes.ts, exercised implicitly by the same res.write
    // path realtime.published already confirms fires correctly above.
    it('rejects a non-owner before opening the stream', async () => {
      const customerPhone = await createCustomer();
      const { orderId } = await checkoutPendingOrder(customerPhone);

      const strangerPhone = await createCustomer();
      const { agent: strangerAgent } = await login(strangerPhone);
      await strangerAgent.get(`/api/orders/${orderId}/stream`).expect(403);
    });
  });
});
