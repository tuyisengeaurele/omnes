/**
 * End-to-end cart tests: real Express app, real Postgres. Exercises the
 * revalidation guarantees phase 4 exists for - stock and price are always
 * checked against the current product row, never trusted from what was
 * stored when a line was added.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
  return `+2507${String(82000000 + phoneCounter).padStart(8, '0')}`;
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

describe('cart routes', () => {
  let cityId: string;
  let zoneId: string;
  let merchantId: string;
  let otherMerchantId: string;
  const usedPhones: string[] = [];
  const createdMerchantIds: string[] = [];

  function freshPhone(): string {
    const phone = uniquePhone();
    usedPhones.push(phone);
    return phone;
  }

  async function createUserWithRole(role: 'OPS'): Promise<{ userId: string; phone: string }> {
    const phone = freshPhone();
    const db = getDb();
    const user = await db.user.create({ data: { phoneE164: phone, displayName: `Test ${role}` } });
    await db.userRole.create({ data: { userId: user.id, role } });
    return { userId: user.id, phone };
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
    await db.user.create({ data: { phoneE164: phone, displayName: 'Test Customer' } });
    await db.userRole.create({
      data: {
        userId: (await db.user.findUniqueOrThrow({ where: { phoneE164: phone } })).id,
        role: 'CUSTOMER',
      },
    });
    return phone;
  }

  beforeAll(async () => {
    const db = getDb();
    const city = await db.city.create({
      data: {
        code: `CC${Date.now()}`,
        name: 'Cart Test City',
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
        name: 'Cart Test Zone',
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

    const ops = await createUserWithRole('OPS');
    const { agent, csrfToken } = await loginAgentWithOwnApp(ops.phone);

    const merchantRes = await agent
      .post('/api/catalog/merchants')
      .set('X-CSRF-Token', csrfToken)
      .send({
        name: 'Cart Test Merchant',
        vertical: 'FOOD',
        cityId,
        zoneId,
        latitude: -1.9441,
        longitude: 30.0619,
        ownerUserId: await createOwnershipTarget(),
      });
    merchantId = merchantRes.body.merchant.id as string;
    createdMerchantIds.push(merchantId);

    const otherRes = await agent
      .post('/api/catalog/merchants')
      .set('X-CSRF-Token', csrfToken)
      .send({
        name: 'Other Cart Merchant',
        vertical: 'FOOD',
        cityId,
        zoneId,
        latitude: -1.9441,
        longitude: 30.0619,
        ownerUserId: await createOwnershipTarget(),
      });
    otherMerchantId = otherRes.body.merchant.id as string;
    createdMerchantIds.push(otherMerchantId);
  });

  afterAll(async () => {
    const db = getDb();
    await db.cartItem.deleteMany({});
    await db.cart.deleteMany({});
    if (createdMerchantIds.length > 0) {
      await db.product.deleteMany({ where: { merchantId: { in: createdMerchantIds } } });
      await db.category.deleteMany({ where: { merchantId: { in: createdMerchantIds } } });
      await db.merchantProfile.deleteMany({ where: { merchantId: { in: createdMerchantIds } } });
      await db.merchant.deleteMany({ where: { id: { in: createdMerchantIds } } });
    }
    await db.feeSchedule.deleteMany({ where: { cityId } });
    for (const phone of usedPhones) {
      const user = await db.user.findUnique({ where: { phoneE164: phone } });
      if (user) {
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

  /** Creates a fresh product directly, so each test has an isolated one to mutate. */
  async function createProduct(
    overrides: {
      priceMinor?: bigint;
      isAvailable?: boolean;
      stockCount?: number | null;
      merchantId?: string;
    } = {}
  ) {
    const db = getDb();
    return db.product.create({
      data: {
        merchantId: overrides.merchantId ?? merchantId,
        name: `Test Product ${Date.now()}-${Math.random()}`,
        priceMinor: overrides.priceMinor ?? 1000n,
        currency: 'RWF',
        isAvailable: overrides.isAvailable ?? true,
        stockCount: overrides.stockCount === undefined ? null : overrides.stockCount,
      },
    });
  }

  describe('add item', () => {
    it('adds a product and reflects it in the cart with computed pricing', async () => {
      const product = await createProduct({ priceMinor: 1000n });
      const phone = await createCustomer();
      const { agent, csrfToken } = await loginAgentWithOwnApp(phone);

      await agent
        .post(`/api/cart/${merchantId}/items`)
        .set('X-CSRF-Token', csrfToken)
        .send({ productId: product.id, quantity: 2 })
        .expect(201);

      const cartRes = await agent.get(`/api/cart/${merchantId}`).expect(200);
      expect(cartRes.body.items).toHaveLength(1);
      expect(cartRes.body.items[0].quantity).toBe(2);
      expect(cartRes.body.pricing.subtotalMinor).toBe('2000');
      // base 500 delivery, 5% of 2000 = 100 service fee
      expect(cartRes.body.pricing.deliveryFeeMinor).toBe('500');
      expect(cartRes.body.pricing.serviceFeeMinor).toBe('100');
      expect(cartRes.body.pricing.totalMinor).toBe('2600');
    });

    it('increments quantity rather than duplicating the line when adding twice', async () => {
      const product = await createProduct();
      const phone = await createCustomer();
      const { agent, csrfToken } = await loginAgentWithOwnApp(phone);

      await agent
        .post(`/api/cart/${merchantId}/items`)
        .set('X-CSRF-Token', csrfToken)
        .send({ productId: product.id, quantity: 1 })
        .expect(201);
      await agent
        .post(`/api/cart/${merchantId}/items`)
        .set('X-CSRF-Token', csrfToken)
        .send({ productId: product.id, quantity: 2 })
        .expect(201);

      const cartRes = await agent.get(`/api/cart/${merchantId}`).expect(200);
      expect(cartRes.body.items).toHaveLength(1);
      expect(cartRes.body.items[0].quantity).toBe(3);
    });

    it('rejects adding more than the available stock', async () => {
      const product = await createProduct({ stockCount: 2 });
      const phone = await createCustomer();
      const { agent, csrfToken } = await loginAgentWithOwnApp(phone);

      const res = await agent
        .post(`/api/cart/${merchantId}/items`)
        .set('X-CSRF-Token', csrfToken)
        .send({ productId: product.id, quantity: 5 })
        .expect(400);

      expect(res.body.error.code).toBe('CART_ADD_FAILED');
      expect(res.body.error.details.availableStock).toBe(2);
    });

    it('rejects adding an unavailable product', async () => {
      const product = await createProduct({ isAvailable: false });
      const phone = await createCustomer();
      const { agent, csrfToken } = await loginAgentWithOwnApp(phone);

      await agent
        .post(`/api/cart/${merchantId}/items`)
        .set('X-CSRF-Token', csrfToken)
        .send({ productId: product.id, quantity: 1 })
        .expect(400);
    });

    it('rejects a product that does not belong to this merchant', async () => {
      const product = await createProduct({ merchantId: otherMerchantId });
      const phone = await createCustomer();
      const { agent, csrfToken } = await loginAgentWithOwnApp(phone);

      const res = await agent
        .post(`/api/cart/${merchantId}/items`)
        .set('X-CSRF-Token', csrfToken)
        .send({ productId: product.id, quantity: 1 })
        .expect(400);
      expect(res.body.error.code).toBe('CART_ADD_FAILED');
    });

    it('rejects adding a total quantity across two calls that exceeds stock', async () => {
      const product = await createProduct({ stockCount: 3 });
      const phone = await createCustomer();
      const { agent, csrfToken } = await loginAgentWithOwnApp(phone);

      await agent
        .post(`/api/cart/${merchantId}/items`)
        .set('X-CSRF-Token', csrfToken)
        .send({ productId: product.id, quantity: 2 })
        .expect(201);

      const res = await agent
        .post(`/api/cart/${merchantId}/items`)
        .set('X-CSRF-Token', csrfToken)
        .send({ productId: product.id, quantity: 2 })
        .expect(400);
      expect(res.body.error.details.availableStock).toBe(3);
    });
  });

  describe('stale state surfaced on read', () => {
    it('flags a price change and prices the cart using the current price', async () => {
      const product = await createProduct({ priceMinor: 1000n });
      const phone = await createCustomer();
      const { agent, csrfToken } = await loginAgentWithOwnApp(phone);

      await agent
        .post(`/api/cart/${merchantId}/items`)
        .set('X-CSRF-Token', csrfToken)
        .send({ productId: product.id, quantity: 1 })
        .expect(201);

      await getDb().product.update({ where: { id: product.id }, data: { priceMinor: 1500n } });

      const cartRes = await agent.get(`/api/cart/${merchantId}`).expect(200);
      expect(cartRes.body.items[0].unitPriceMinor).toBe('1500');
      expect(cartRes.body.pricing.subtotalMinor).toBe('1500');
      const issue = cartRes.body.issues.find(
        (i: { productId: string }) => i.productId === product.id
      );
      expect(issue.issue).toBe('PRICE_CHANGED');
      expect(issue.currentPriceMinor).toBe('1500');
    });

    it('flags a product that became unavailable after being added, and excludes it from pricing', async () => {
      const product = await createProduct({ priceMinor: 1000n });
      const phone = await createCustomer();
      const { agent, csrfToken } = await loginAgentWithOwnApp(phone);

      await agent
        .post(`/api/cart/${merchantId}/items`)
        .set('X-CSRF-Token', csrfToken)
        .send({ productId: product.id, quantity: 1 })
        .expect(201);

      await getDb().product.update({ where: { id: product.id }, data: { isAvailable: false } });

      const cartRes = await agent.get(`/api/cart/${merchantId}`).expect(200);
      expect(cartRes.body.pricing.subtotalMinor).toBe('0');
      const issue = cartRes.body.issues.find(
        (i: { productId: string }) => i.productId === product.id
      );
      expect(issue.issue).toBe('UNAVAILABLE');
    });

    it('flags a line that now exceeds newly reduced stock', async () => {
      const product = await createProduct({ priceMinor: 1000n, stockCount: 5 });
      const phone = await createCustomer();
      const { agent, csrfToken } = await loginAgentWithOwnApp(phone);

      await agent
        .post(`/api/cart/${merchantId}/items`)
        .set('X-CSRF-Token', csrfToken)
        .send({ productId: product.id, quantity: 4 })
        .expect(201);

      await getDb().product.update({ where: { id: product.id }, data: { stockCount: 1 } });

      const cartRes = await agent.get(`/api/cart/${merchantId}`).expect(200);
      const issue = cartRes.body.issues.find(
        (i: { productId: string }) => i.productId === product.id
      );
      expect(issue.issue).toBe('INSUFFICIENT_STOCK');
      expect(issue.availableStock).toBe(1);
      expect(cartRes.body.pricing.subtotalMinor).toBe('0');
    });
  });

  describe('update and remove', () => {
    it('updates quantity and re-prices using the current price', async () => {
      const product = await createProduct({ priceMinor: 1000n });
      const phone = await createCustomer();
      const { agent, csrfToken } = await loginAgentWithOwnApp(phone);

      const addRes = await agent
        .post(`/api/cart/${merchantId}/items`)
        .set('X-CSRF-Token', csrfToken)
        .send({ productId: product.id, quantity: 1 });
      const itemId = addRes.body.item.id as string;

      await agent
        .patch(`/api/cart/${merchantId}/items/${itemId}`)
        .set('X-CSRF-Token', csrfToken)
        .send({ quantity: 3 })
        .expect(200);

      const cartRes = await agent.get(`/api/cart/${merchantId}`).expect(200);
      expect(cartRes.body.items[0].quantity).toBe(3);
      expect(cartRes.body.pricing.subtotalMinor).toBe('3000');
    });

    it('rejects updating quantity above current stock', async () => {
      const product = await createProduct({ stockCount: 2 });
      const phone = await createCustomer();
      const { agent, csrfToken } = await loginAgentWithOwnApp(phone);

      const addRes = await agent
        .post(`/api/cart/${merchantId}/items`)
        .set('X-CSRF-Token', csrfToken)
        .send({ productId: product.id, quantity: 1 });
      const itemId = addRes.body.item.id as string;

      const res = await agent
        .patch(`/api/cart/${merchantId}/items/${itemId}`)
        .set('X-CSRF-Token', csrfToken)
        .send({ quantity: 10 })
        .expect(400);
      expect(res.body.error.details.availableStock).toBe(2);
    });

    it('removes an item from the cart', async () => {
      const product = await createProduct();
      const phone = await createCustomer();
      const { agent, csrfToken } = await loginAgentWithOwnApp(phone);

      const addRes = await agent
        .post(`/api/cart/${merchantId}/items`)
        .set('X-CSRF-Token', csrfToken)
        .send({ productId: product.id, quantity: 1 });
      const itemId = addRes.body.item.id as string;

      await agent
        .delete(`/api/cart/${merchantId}/items/${itemId}`)
        .set('X-CSRF-Token', csrfToken)
        .expect(204);

      const cartRes = await agent.get(`/api/cart/${merchantId}`).expect(200);
      expect(cartRes.body.items).toHaveLength(0);
    });

    it('clears the whole cart', async () => {
      const productA = await createProduct();
      const productB = await createProduct();
      const phone = await createCustomer();
      const { agent, csrfToken } = await loginAgentWithOwnApp(phone);

      await agent
        .post(`/api/cart/${merchantId}/items`)
        .set('X-CSRF-Token', csrfToken)
        .send({ productId: productA.id, quantity: 1 });
      await agent
        .post(`/api/cart/${merchantId}/items`)
        .set('X-CSRF-Token', csrfToken)
        .send({ productId: productB.id, quantity: 1 });

      await agent.delete(`/api/cart/${merchantId}`).set('X-CSRF-Token', csrfToken).expect(204);

      const cartRes = await agent.get(`/api/cart/${merchantId}`).expect(200);
      expect(cartRes.body.items).toHaveLength(0);
    });

    it("does not let one customer modify another customer's cart item", async () => {
      const product = await createProduct();
      const ownerPhone = await createCustomer();
      const ownerSession = await loginAgentWithOwnApp(ownerPhone);

      const addRes = await ownerSession.agent
        .post(`/api/cart/${merchantId}/items`)
        .set('X-CSRF-Token', ownerSession.csrfToken)
        .send({ productId: product.id, quantity: 1 });
      const itemId = addRes.body.item.id as string;

      const intruderPhone = await createCustomer();
      const intruderSession = await loginAgentWithOwnApp(intruderPhone);

      const res = await intruderSession.agent
        .patch(`/api/cart/${merchantId}/items/${itemId}`)
        .set('X-CSRF-Token', intruderSession.csrfToken)
        .send({ quantity: 5 })
        .expect(404);
      expect(res.body.error.code).toBe('CART_ITEM_NOT_FOUND');
    });
  });

  describe('empty cart', () => {
    it('returns a zeroed view with a null cartId when nothing has been added', async () => {
      const phone = await createCustomer();
      const { agent } = await loginAgentWithOwnApp(phone);

      const res = await agent.get(`/api/cart/${merchantId}`).expect(200);
      expect(res.body.cartId).toBeNull();
      expect(res.body.items).toHaveLength(0);
      expect(res.body.pricing.totalMinor).toBe('0');
      expect(res.body.currency).toBe('RWF');
    });
  });

  describe('authentication', () => {
    it('rejects every cart route with no session', async () => {
      const app = createApp({ config, logger, smsPort: createSpySmsPort().port });
      await request(app).get(`/api/cart/${merchantId}`).expect(401);
      await request(app).post(`/api/cart/${merchantId}/items`).send({}).expect(401);
    });
  });
});
