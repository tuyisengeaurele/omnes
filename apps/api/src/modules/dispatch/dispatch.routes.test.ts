/**
 * End-to-end dispatch tests: real Express app, real Postgres. Drives an
 * order all the way from checkout through payment, merchant prep, and the
 * offer/accept/decline/timeout loop to delivery - the full loop the build
 * plan's phase 8 customer web needs working before it starts. Also covers
 * the driverless-zone fallback FR-DISP-004 calls for explicitly.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
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

// Raised for this file's app instance only - see lifecycle.routes.test.ts,
// which does the same for the same reason: many more logins here than the
// default auth rate limit allows. Offer timeout is dropped to one second
// so the lazy-timeout path can be exercised with a real (short) wait
// instead of mocking the clock.
const config = {
  ...getConfig(),
  RATE_LIMIT_AUTH_MAX_REQUESTS: 1000,
  DISPATCH_OFFER_TIMEOUT_SECONDS: 1,
};
const logger = getLogger();

let phoneCounter = 0;
function uniquePhone(): string {
  phoneCounter += 1;
  return `+2507${String(87000000 + phoneCounter).padStart(8, '0')}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('dispatch routes', () => {
  let cityId: string;
  let zoneId: string;
  let merchantId: string;
  const merchantCoords = { latitude: -1.9441, longitude: 30.0619 };
  const nearCoords = { latitude: -1.945, longitude: 30.063 }; // a few hundred meters away
  const usedPhones: string[] = [];
  const createdMerchantIds: string[] = [];
  const createdOrderIds: string[] = [];
  const createdDriverProfileIds: string[] = [];
  let app: ReturnType<typeof createApp>;
  let opsAgent: request.Agent;
  let opsCsrf: string;

  function freshPhone(): string {
    const phone = uniquePhone();
    usedPhones.push(phone);
    return phone;
  }

  async function login(phoneE164: string) {
    const agent = request.agent(app);
    await agent.post('/api/auth/login/request-otp').send({ phoneE164 }).expect(202);
    const code = sharedSms.lastCodeFor(phoneE164);
    const res = await agent.post('/api/auth/login/verify').send({ phoneE164, code }).expect(200);
    return { agent, csrfToken: res.body.csrfToken as string };
  }

  let sharedSms: ReturnType<typeof createSpySmsPort>;

  async function createCustomer(): Promise<string> {
    const phone = freshPhone();
    const db = getDb();
    const user = await db.user.create({ data: { phoneE164: phone, displayName: 'Test Customer' } });
    await db.userRole.create({ data: { userId: user.id, role: 'CUSTOMER' } });
    return phone;
  }

  /** Provisions a driver via the ops-only route and returns their phone and driverId. */
  async function createDriver(): Promise<{ phone: string; driverId: string }> {
    const phone = freshPhone();
    const db = getDb();
    const user = await db.user.create({ data: { phoneE164: phone, displayName: 'Test Driver' } });
    const res = await opsAgent
      .post('/api/drivers')
      .set('X-CSRF-Token', opsCsrf)
      .send({ userId: user.id, vehicleType: 'MOTO' })
      .expect(201);
    const driverId = res.body.driver.id as string;
    createdDriverProfileIds.push(driverId);
    return { phone, driverId };
  }

  // Every test in this file shares one merchant location, so a driver left
  // online by one test would be a real (and confusing) candidate for the
  // next one's dispatch attempts - including the driverless-zone test,
  // which specifically depends on nobody being online. Tracked here and
  // swept offline in afterEach rather than trusting each test to remember.
  const onlineAgents: Array<{ agent: request.Agent; csrfToken: string }> = [];

  async function goOnlineNear(
    driverPhone: string,
    coords: { latitude: number; longitude: number }
  ) {
    const { agent, csrfToken } = await login(driverPhone);
    await agent
      .post('/api/dispatch/availability')
      .set('X-CSRF-Token', csrfToken)
      .send({ isOnline: true })
      .expect(200);
    await agent
      .post('/api/dispatch/location')
      .set('X-CSRF-Token', csrfToken)
      .send({ ...coords, accuracyM: 8 })
      .expect(204);
    onlineAgents.push({ agent, csrfToken });
    return { agent, csrfToken };
  }

  afterEach(async () => {
    for (const { agent, csrfToken } of onlineAgents) {
      await agent
        .post('/api/dispatch/availability')
        .set('X-CSRF-Token', csrfToken)
        .send({ isOnline: false });
    }
    onlineAgents.length = 0;
  });

  async function createProduct(priceMinor = 1000n) {
    const db = getDb();
    return db.product.create({
      data: {
        merchantId,
        name: `Dispatch Route Test Product ${Date.now()}-${Math.random()}`,
        priceMinor,
        currency: 'RWF',
        isAvailable: true,
        stockCount: null,
      },
    });
  }

  /** Runs checkout through webhook success through merchant prep, ending with the order READY_FOR_PICKUP. */
  async function createReadyOrder(): Promise<{
    orderId: string;
    orderNumber: string;
    merchantAgent: request.Agent;
    merchantCsrf: string;
  }> {
    const product = await createProduct(1500n);
    const customerPhone = await createCustomer();
    const { agent, csrfToken } = await login(customerPhone);

    await agent
      .post(`/api/cart/${merchantId}/items`)
      .set('X-CSRF-Token', csrfToken)
      .send({ productId: product.id, quantity: 1 })
      .expect(201);

    const checkoutRes = await agent
      .post(`/api/checkout/${merchantId}`)
      .set('X-CSRF-Token', csrfToken)
      .send({
        address: { label: 'Home', latitude: -1.95, longitude: 30.07 },
        paymentMethod: 'MTN_MOMO',
        payerPhone: customerPhone,
        idempotencyKey: randomUUID(),
      })
      .expect(201);

    const orderId = checkoutRes.body.orderId as string;
    const orderNumber = checkoutRes.body.orderNumber as string;
    createdOrderIds.push(orderId);

    const db = getDb();
    const intent = await db.paymentIntent.findFirstOrThrow({ where: { orderId } });
    if (!intent.providerRef) throw new Error('expected a providerRef');

    await request(app)
      .post('/api/payments/webhooks/mock')
      .set('X-Webhook-Secret', config.PAYMENT_WEBHOOK_SECRET)
      .send({ providerRef: intent.providerRef, status: 'SUCCEEDED' })
      .expect(200);

    const { agent: merchantAgent, csrfToken: merchantCsrf } = await login(merchantOwnerPhone);
    await merchantAgent
      .post(`/api/orders/${orderId}/accept`)
      .set('X-CSRF-Token', merchantCsrf)
      .send()
      .expect(200);
    await merchantAgent
      .post(`/api/orders/${orderId}/prepare`)
      .set('X-CSRF-Token', merchantCsrf)
      .send()
      .expect(200);
    await merchantAgent
      .post(`/api/orders/${orderId}/ready`)
      .set('X-CSRF-Token', merchantCsrf)
      .send()
      .expect(200);

    return { orderId, orderNumber, merchantAgent, merchantCsrf };
  }

  let merchantOwnerPhone: string;

  beforeAll(async () => {
    const db = getDb();
    const city = await db.city.create({
      data: {
        code: `DP${Date.now()}`,
        name: 'Dispatch Route Test City',
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
        name: 'Dispatch Route Test Zone',
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
    app = createApp({ config, logger, smsPort: sharedSms.port });

    const opsPhone = freshPhone();
    const opsUser = await db.user.create({ data: { phoneE164: opsPhone, displayName: 'Ops' } });
    await db.userRole.create({ data: { userId: opsUser.id, role: 'OPS' } });
    const opsLogin = await login(opsPhone);
    opsAgent = opsLogin.agent;
    opsCsrf = opsLogin.csrfToken;

    merchantOwnerPhone = freshPhone();
    const ownerUser = await db.user.create({
      data: { phoneE164: merchantOwnerPhone, displayName: 'Merchant Owner' },
    });
    const merchantRes = await opsAgent
      .post('/api/catalog/merchants')
      .set('X-CSRF-Token', opsCsrf)
      .send({
        name: 'Dispatch Route Test Merchant',
        vertical: 'FOOD',
        cityId,
        zoneId,
        latitude: merchantCoords.latitude,
        longitude: merchantCoords.longitude,
        ownerUserId: ownerUser.id,
      });
    merchantId = merchantRes.body.merchant.id as string;
    createdMerchantIds.push(merchantId);
  });

  afterAll(async () => {
    const db = getDb();
    await db.dispatchDecision.deleteMany({ where: { orderId: { in: createdOrderIds } } });
    await db.dispatchOffer.deleteMany({ where: { orderId: { in: createdOrderIds } } });
    await db.assignment.deleteMany({ where: { orderId: { in: createdOrderIds } } });
    await db.orderEvent.deleteMany({ where: { orderId: { in: createdOrderIds } } });
    await db.orderItem.deleteMany({ where: { orderId: { in: createdOrderIds } } });
    await db.paymentAttempt.deleteMany({ where: { intent: { orderId: { in: createdOrderIds } } } });
    await db.paymentIntent.deleteMany({ where: { orderId: { in: createdOrderIds } } });
    await db.order.deleteMany({ where: { id: { in: createdOrderIds } } });
    await db.cartItem.deleteMany({});
    await db.cart.deleteMany({});
    await db.driverLocation.deleteMany({ where: { driverId: { in: createdDriverProfileIds } } });
    await db.driverAvailability.deleteMany({
      where: { driverId: { in: createdDriverProfileIds } },
    });
    await db.driverProfile.deleteMany({ where: { id: { in: createdDriverProfileIds } } });
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

  it('runs a full order through offer, accept, pickup and delivery', async () => {
    const driver = await createDriver();
    const { agent: driverAgent, csrfToken: driverCsrf } = await goOnlineNear(
      driver.phone,
      nearCoords
    );
    const { orderId } = await createReadyOrder();

    const offersRes = await driverAgent.get('/api/dispatch/offers').expect(200);
    expect(offersRes.body.offers).toHaveLength(1);
    const offerId = offersRes.body.offers[0].id as string;

    const acceptRes = await driverAgent
      .post(`/api/dispatch/offers/${offerId}/accept`)
      .set('X-CSRF-Token', driverCsrf)
      .send()
      .expect(200);
    const assignmentId = acceptRes.body.assignmentId as string;

    const db = getDb();
    let order = await db.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe('ASSIGNED');

    await driverAgent
      .post(`/api/dispatch/assignments/${assignmentId}/picked-up`)
      .set('X-CSRF-Token', driverCsrf)
      .send()
      .expect(200, { status: 'PICKED_UP' });

    order = await db.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe('PICKED_UP');

    await driverAgent
      .post(`/api/dispatch/assignments/${assignmentId}/delivered`)
      .set('X-CSRF-Token', driverCsrf)
      .send()
      .expect(200, { status: 'DELIVERED' });

    order = await db.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe('DELIVERED');

    const assignment = await db.assignment.findUniqueOrThrow({ where: { id: assignmentId } });
    expect(assignment.completedAt).not.toBeNull();
  });

  it('offers the next nearest driver when the first declines', async () => {
    const first = await createDriver();
    const second = await createDriver();
    const { agent: firstAgent, csrfToken: firstCsrf } = await goOnlineNear(first.phone, nearCoords);
    // Slightly further, but still well within the initial radius.
    await goOnlineNear(second.phone, { latitude: -1.947, longitude: 30.066 });
    const { orderId } = await createReadyOrder();

    const offersRes = await firstAgent.get('/api/dispatch/offers').expect(200);
    const firstOfferId = offersRes.body.offers[0].id as string;

    await firstAgent
      .post(`/api/dispatch/offers/${firstOfferId}/decline`)
      .set('X-CSRF-Token', firstCsrf)
      .send()
      .expect(204);

    const { agent: secondAgent } = await login(second.phone);
    const secondOffersRes = await secondAgent.get('/api/dispatch/offers').expect(200);
    expect(secondOffersRes.body.offers).toHaveLength(1);

    const db = getDb();
    const offers = await db.dispatchOffer.findMany({ where: { orderId } });
    expect(offers).toHaveLength(2);
    expect(offers.find((o) => o.driverId === first.driverId)?.outcome).toBe('DECLINED');
  });

  it('resolves an unanswered offer as a timeout and moves to the next candidate', async () => {
    const first = await createDriver();
    const second = await createDriver();
    await goOnlineNear(first.phone, nearCoords);
    await goOnlineNear(second.phone, { latitude: -1.947, longitude: 30.066 });
    const { orderId } = await createReadyOrder();

    // DISPATCH_OFFER_TIMEOUT_SECONDS is 1 for this file's app instance.
    await sleep(1200);

    // A real driver app polls its own open offers while waiting, which is
    // what actually notices this one expired and advances dispatch to the
    // next candidate - see dispatch.routes.ts's GET /offers. Nothing
    // advances it on the second driver's behalf until they have an offer
    // of their own to poll for.
    const { agent: firstAgent } = await login(first.phone);
    await firstAgent.get('/api/dispatch/offers').expect(200);

    const { agent: secondAgent } = await login(second.phone);
    const offersRes = await secondAgent.get('/api/dispatch/offers').expect(200);
    expect(offersRes.body.offers).toHaveLength(1);

    const db = getDb();
    const firstOffer = await db.dispatchOffer.findFirstOrThrow({
      where: { orderId, driverId: first.driverId },
    });
    expect(firstOffer.outcome).toBe('TIMEOUT');
  });

  it('rejects a driver accepting an offer that is not theirs', async () => {
    const owner = await createDriver();
    const stranger = await createDriver();
    await goOnlineNear(owner.phone, nearCoords);
    await createReadyOrder();

    const { agent: ownerAgent } = await login(owner.phone);
    const offersRes = await ownerAgent.get('/api/dispatch/offers').expect(200);
    const offerId = offersRes.body.offers[0].id as string;

    const { agent: strangerAgent, csrfToken: strangerCsrf } = await login(stranger.phone);
    await strangerAgent
      .post(`/api/dispatch/offers/${offerId}/accept`)
      .set('X-CSRF-Token', strangerCsrf)
      .send()
      .expect(403);
  });

  it('leaves an order needing ops attention when no driver is online anywhere nearby', async () => {
    const { orderId } = await createReadyOrder();

    const needsAttentionRes = await opsAgent.get('/api/dispatch/needs-attention').expect(200);
    const ids = (needsAttentionRes.body.items as Array<{ orderId: string }>).map((i) => i.orderId);
    expect(ids).toContain(orderId);

    const db = getDb();
    const order = await db.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe('READY_FOR_PICKUP');
    const openOffer = await db.dispatchOffer.findFirst({ where: { orderId, outcome: null } });
    expect(openOffer).toBeNull();
  });

  it('rejects dispatch actions from a user with no approved driver profile', async () => {
    const phone = await createCustomer();
    const { agent, csrfToken } = await login(phone);

    await agent
      .post('/api/dispatch/availability')
      .set('X-CSRF-Token', csrfToken)
      .send({ isOnline: true })
      .expect(403);
  });
});
