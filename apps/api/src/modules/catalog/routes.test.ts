/**
 * End-to-end catalog tests: real Express app, real Postgres. Exercises
 * public listing, geo sort, search, menu assembly, and the RBAC/ownership
 * rules on merchant, category, and product writes.
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
  return `+2507${String(81000000 + phoneCounter).padStart(8, '0')}`;
}

/**
 * Logs in via the real HTTP auth flow, on a dedicated app instance whose
 * SmsPort is this call's own spy - so the code it captures is guaranteed to
 * be the one actually issued to this phone through this app, rather than
 * risking a spy that is not wired to whichever app the caller already has.
 */
async function loginAgentWithOwnApp(phoneE164: string) {
  const sms = createSpySmsPort();
  const app = createApp({ config, logger, smsPort: sms.port });
  const agent = request.agent(app);
  await agent.post('/api/auth/login/request-otp').send({ phoneE164 });
  const code = sms.lastCodeFor(phoneE164);
  const res = await agent.post('/api/auth/login/verify').send({ phoneE164, code });
  return { agent, app, csrfToken: res.body.csrfToken as string };
}

describe('catalog routes', () => {
  let cityId: string;
  let zoneId: string;
  const usedPhones: string[] = [];
  const createdMerchantIds: string[] = [];

  function freshPhone(): string {
    const phone = uniquePhone();
    usedPhones.push(phone);
    return phone;
  }

  beforeAll(async () => {
    const db = getDb();
    const city = await db.city.create({
      data: {
        code: `TC${Date.now()}`,
        name: 'Test City',
        countryCode: 'RW',
        currency: 'RWF',
        timezone: 'Africa/Kigali',
        activeVerticals: ['FOOD', 'GROCERY'],
      },
    });
    cityId = city.id;
    const zone = await db.zone.create({
      data: {
        cityId,
        name: 'Test Zone',
        polygon: { type: 'Point', coordinates: [30.0619, -1.9441] },
        deliveryRadiusM: 5000,
      },
    });
    zoneId = zone.id;
  });

  afterAll(async () => {
    const db = getDb();
    if (createdMerchantIds.length > 0) {
      await db.product.deleteMany({ where: { merchantId: { in: createdMerchantIds } } });
      await db.category.deleteMany({ where: { merchantId: { in: createdMerchantIds } } });
      await db.merchantProfile.deleteMany({ where: { merchantId: { in: createdMerchantIds } } });
      await db.merchant.deleteMany({ where: { id: { in: createdMerchantIds } } });
    }
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

  /** Creates a user with the given role directly, bypassing self-registration. */
  async function createUserWithRole(
    role: 'OPS' | 'SUPER_ADMIN'
  ): Promise<{ userId: string; phone: string }> {
    const phone = freshPhone();
    const db = getDb();
    const user = await db.user.create({ data: { phoneE164: phone, displayName: `Test ${role}` } });
    await db.userRole.create({ data: { userId: user.id, role } });
    return { userId: user.id, phone };
  }

  async function createUserForOwnership(): Promise<{ userId: string; phone: string }> {
    const phone = freshPhone();
    const db = getDb();
    const user = await db.user.create({
      data: { phoneE164: phone, displayName: 'Prospective Owner' },
    });
    return { userId: user.id, phone };
  }

  describe('GET /merchants', () => {
    it('lists merchants filtered by city, and paginates', async () => {
      const ops = await createUserWithRole('OPS');
      const { agent, app, csrfToken } = await loginAgentWithOwnApp(ops.phone);

      const names = ['Alpha Diner', 'Beta Kitchen', 'Gamma Grill'];
      for (const name of names) {
        const res = await agent
          .post('/api/catalog/merchants')
          .set('X-CSRF-Token', csrfToken)
          .send({
            name,
            vertical: 'FOOD',
            cityId,
            zoneId,
            latitude: -1.9441,
            longitude: 30.0619,
            ownerUserId: (await createUserForOwnership()).userId,
          });
        createdMerchantIds.push(res.body.merchant.id);
      }

      const page1 = await request(app)
        .get('/api/catalog/merchants')
        .query({ cityId, limit: 2 })
        .expect(200);
      expect(page1.body.items).toHaveLength(2);
      expect(page1.body.nextCursor).toBeTruthy();

      const page2 = await request(app)
        .get('/api/catalog/merchants')
        .query({ cityId, limit: 2, cursor: page1.body.nextCursor })
        .expect(200);
      expect(page2.body.items.length).toBeGreaterThanOrEqual(1);

      const page1Ids = page1.body.items.map((m: { id: string }) => m.id);
      const page2Ids = page2.body.items.map((m: { id: string }) => m.id);
      expect(page1Ids.some((id: string) => page2Ids.includes(id))).toBe(false);
    });

    it('rejects a request with no cityId', async () => {
      const app = createApp({ config, logger, smsPort: createSpySmsPort().port });
      const res = await request(app).get('/api/catalog/merchants').expect(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('sorts by distance and reports distanceMeters when a near point is given', async () => {
      const ops = await createUserWithRole('OPS');
      const { agent, app, csrfToken } = await loginAgentWithOwnApp(ops.phone);

      const near = await agent
        .post('/api/catalog/merchants')
        .set('X-CSRF-Token', csrfToken)
        .send({
          name: 'Near Merchant',
          vertical: 'FOOD',
          cityId,
          zoneId,
          latitude: -1.9441,
          longitude: 30.0619,
          ownerUserId: (await createUserForOwnership()).userId,
        });
      createdMerchantIds.push(near.body.merchant.id);

      const far = await agent
        .post('/api/catalog/merchants')
        .set('X-CSRF-Token', csrfToken)
        .send({
          name: 'Far Merchant',
          vertical: 'FOOD',
          cityId,
          zoneId,
          latitude: -1.99,
          longitude: 30.12,
          ownerUserId: (await createUserForOwnership()).userId,
        });
      createdMerchantIds.push(far.body.merchant.id);

      const res = await request(app)
        .get('/api/catalog/merchants')
        .query({ cityId, latitude: -1.9441, longitude: 30.0619, radiusM: 20000, limit: 50 })
        .expect(200);

      const ids = res.body.items.map((m: { id: string }) => m.id);
      const nearIndex = ids.indexOf(near.body.merchant.id);
      const farIndex = ids.indexOf(far.body.merchant.id);
      expect(nearIndex).toBeGreaterThanOrEqual(0);
      expect(farIndex).toBeGreaterThan(nearIndex);
      expect(res.body.items[nearIndex].distanceMeters).toBeLessThan(
        res.body.items[farIndex].distanceMeters
      );
    });

    it('sorts by rating and filters by minRating, in both geo and non-geo mode', async () => {
      const ops = await createUserWithRole('OPS');
      const { agent, app, csrfToken } = await loginAgentWithOwnApp(ops.phone);
      const db = getDb();

      const lowRes = await agent
        .post('/api/catalog/merchants')
        .set('X-CSRF-Token', csrfToken)
        .send({
          name: 'Low Rated',
          vertical: 'FOOD',
          cityId,
          zoneId,
          latitude: -1.9441,
          longitude: 30.0619,
          ownerUserId: (await createUserForOwnership()).userId,
        });
      const highRes = await agent
        .post('/api/catalog/merchants')
        .set('X-CSRF-Token', csrfToken)
        .send({
          name: 'High Rated',
          vertical: 'FOOD',
          cityId,
          zoneId,
          latitude: -1.9441,
          longitude: 30.0619,
          ownerUserId: (await createUserForOwnership()).userId,
        });
      const lowId = lowRes.body.merchant.id as string;
      const highId = highRes.body.merchant.id as string;
      createdMerchantIds.push(lowId, highId);

      await db.merchant.update({ where: { id: lowId }, data: { rating: 2.0 } });
      await db.merchant.update({ where: { id: highId }, data: { rating: 4.8 } });

      const sorted = await request(app)
        .get('/api/catalog/merchants')
        .query({ cityId, sortBy: 'rating', limit: 50 })
        .expect(200);
      const sortedIds = sorted.body.items.map((m: { id: string }) => m.id);
      expect(sortedIds.indexOf(highId)).toBeLessThan(sortedIds.indexOf(lowId));

      const filtered = await request(app)
        .get('/api/catalog/merchants')
        .query({ cityId, minRating: '4', limit: 50 })
        .expect(200);
      const filteredIds = filtered.body.items.map((m: { id: string }) => m.id);
      expect(filteredIds).toContain(highId);
      expect(filteredIds).not.toContain(lowId);

      const geoSorted = await request(app)
        .get('/api/catalog/merchants')
        .query({
          cityId,
          latitude: -1.9441,
          longitude: 30.0619,
          radiusM: 20000,
          sortBy: 'rating',
          limit: 50,
        })
        .expect(200);
      const geoSortedIds = geoSorted.body.items.map((m: { id: string }) => m.id);
      expect(geoSortedIds.indexOf(highId)).toBeLessThan(geoSortedIds.indexOf(lowId));
      // Still reports distance even though rating, not distance, chose the order.
      expect(geoSorted.body.items[geoSortedIds.indexOf(highId)].distanceMeters).toBeTypeOf(
        'number'
      );
    });
  });

  describe('GET /merchants/:id and search', () => {
    it('returns the menu with only available products', async () => {
      const ops = await createUserWithRole('OPS');
      const { agent, app, csrfToken } = await loginAgentWithOwnApp(ops.phone);

      const merchantRes = await agent
        .post('/api/catalog/merchants')
        .set('X-CSRF-Token', csrfToken)
        .send({
          name: 'Menu Test Merchant',
          vertical: 'FOOD',
          cityId,
          zoneId,
          latitude: -1.9441,
          longitude: 30.0619,
          ownerUserId: (await createUserForOwnership()).userId,
        });
      const merchantId = merchantRes.body.merchant.id as string;
      createdMerchantIds.push(merchantId);

      const catRes = await agent
        .post(`/api/catalog/merchants/${merchantId}/categories`)
        .set('X-CSRF-Token', csrfToken)
        .send({ name: 'Mains' });
      const categoryId = catRes.body.category.id as string;

      await agent
        .post(`/api/catalog/merchants/${merchantId}/products`)
        .set('X-CSRF-Token', csrfToken)
        .send({
          categoryId,
          name: 'Available Dish',
          priceMinor: '1000',
          currency: 'RWF',
          isAvailable: true,
        });
      await agent
        .post(`/api/catalog/merchants/${merchantId}/products`)
        .set('X-CSRF-Token', csrfToken)
        .send({
          categoryId,
          name: 'Unavailable Dish',
          priceMinor: '1000',
          currency: 'RWF',
          isAvailable: false,
        });

      const menu = await request(app).get(`/api/catalog/merchants/${merchantId}`).expect(200);

      const productNames = menu.body.categories.flatMap((c: { products: { name: string }[] }) =>
        c.products.map((p) => p.name)
      );
      expect(productNames).toContain('Available Dish');
      expect(productNames).not.toContain('Unavailable Dish');
    });

    it('returns 404 for an unknown merchant', async () => {
      const app = createApp({ config, logger, smsPort: createSpySmsPort().port });
      const res = await request(app)
        .get('/api/catalog/merchants/00000000-0000-0000-0000-000000000000')
        .expect(404);
      expect(res.body.error.code).toBe('MERCHANT_NOT_FOUND');
    });

    it('finds a merchant by name via search', async () => {
      const ops = await createUserWithRole('OPS');
      const { agent, app, csrfToken } = await loginAgentWithOwnApp(ops.phone);

      const uniqueName = `Zephyr Kitchen ${Date.now()}`;
      const res = await agent
        .post('/api/catalog/merchants')
        .set('X-CSRF-Token', csrfToken)
        .send({
          name: uniqueName,
          vertical: 'FOOD',
          cityId,
          zoneId,
          latitude: -1.9441,
          longitude: 30.0619,
          ownerUserId: (await createUserForOwnership()).userId,
        });
      createdMerchantIds.push(res.body.merchant.id);

      const searchRes = await request(app)
        .get('/api/catalog/search')
        .query({ cityId, q: 'Zephyr' })
        .expect(200);

      expect(searchRes.body.merchants.some((m: { name: string }) => m.name === uniqueName)).toBe(
        true
      );
    });
  });

  describe('merchant write RBAC', () => {
    it('rejects merchant creation from a plain customer', async () => {
      const customerPhone = freshPhone();
      const db = getDb();
      await db.user.create({ data: { phoneE164: customerPhone, displayName: 'Plain Customer' } });
      await db.userRole.create({
        data: {
          userId: (await db.user.findUniqueOrThrow({ where: { phoneE164: customerPhone } })).id,
          role: 'CUSTOMER',
        },
      });

      const { agent, csrfToken } = await loginAgentWithOwnApp(customerPhone);
      const res = await agent
        .post('/api/catalog/merchants')
        .set('X-CSRF-Token', csrfToken)
        .send({
          name: 'Should Not Exist',
          vertical: 'FOOD',
          cityId,
          zoneId,
          latitude: -1.9441,
          longitude: 30.0619,
          // A syntactically valid but nonexistent id: irrelevant here, since
          // requireRole runs before the body is even parsed and should
          // reject this request on role alone, before the value is used.
          ownerUserId: '00000000-0000-0000-0000-000000000000',
        })
        .expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('rejects merchant creation with no session at all', async () => {
      const app = createApp({ config, logger, smsPort: createSpySmsPort().port });
      const res = await request(app)
        .post('/api/catalog/merchants')
        .send({
          name: 'Should Not Exist',
          vertical: 'FOOD',
          cityId,
          zoneId,
          latitude: -1.9441,
          longitude: 30.0619,
          ownerUserId: '00000000-0000-0000-0000-000000000000',
        })
        .expect(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('lets a merchant owner update their own merchant but not another one', async () => {
      const ops = await createUserWithRole('OPS');
      const opsSession = await loginAgentWithOwnApp(ops.phone);

      const ownerA = await createUserForOwnership();
      const merchantARes = await opsSession.agent
        .post('/api/catalog/merchants')
        .set('X-CSRF-Token', opsSession.csrfToken)
        .send({
          name: 'Owner A Merchant',
          vertical: 'FOOD',
          cityId,
          zoneId,
          latitude: -1.9441,
          longitude: 30.0619,
          ownerUserId: ownerA.userId,
        });
      const merchantAId = merchantARes.body.merchant.id as string;
      createdMerchantIds.push(merchantAId);

      const ownerB = await createUserForOwnership();
      const merchantBRes = await opsSession.agent
        .post('/api/catalog/merchants')
        .set('X-CSRF-Token', opsSession.csrfToken)
        .send({
          name: 'Owner B Merchant',
          vertical: 'FOOD',
          cityId,
          zoneId,
          latitude: -1.9441,
          longitude: 30.0619,
          ownerUserId: ownerB.userId,
        });
      const merchantBId = merchantBRes.body.merchant.id as string;
      createdMerchantIds.push(merchantBId);

      const ownerASession = await loginAgentWithOwnApp(ownerA.phone);

      // Owner A can update their own merchant.
      await ownerASession.agent
        .patch(`/api/catalog/merchants/${merchantAId}`)
        .set('X-CSRF-Token', ownerASession.csrfToken)
        .send({ isOpen: false })
        .expect(200);

      // Owner A cannot update merchant B.
      const forbidden = await ownerASession.agent
        .patch(`/api/catalog/merchants/${merchantBId}`)
        .set('X-CSRF-Token', ownerASession.csrfToken)
        .send({ isOpen: false })
        .expect(403);
      expect(forbidden.body.error.code).toBe('FORBIDDEN');
    });

    it('refuses to create a merchant for an owner who does not exist', async () => {
      const ops = await createUserWithRole('OPS');
      const { agent, csrfToken } = await loginAgentWithOwnApp(ops.phone);

      const res = await agent
        .post('/api/catalog/merchants')
        .set('X-CSRF-Token', csrfToken)
        .send({
          name: 'Orphan Attempt',
          vertical: 'FOOD',
          cityId,
          zoneId,
          latitude: -1.9441,
          longitude: 30.0619,
          ownerUserId: '00000000-0000-0000-0000-000000000000',
        })
        .expect(400);
      expect(res.body.error.code).toBe('OWNER_NOT_FOUND');
    });

    it('rejects a product whose category belongs to a different merchant', async () => {
      const ops = await createUserWithRole('OPS');
      const { agent, csrfToken } = await loginAgentWithOwnApp(ops.phone);

      const merchantARes = await agent
        .post('/api/catalog/merchants')
        .set('X-CSRF-Token', csrfToken)
        .send({
          name: 'Cross Merchant A',
          vertical: 'FOOD',
          cityId,
          zoneId,
          latitude: -1.9441,
          longitude: 30.0619,
          ownerUserId: (await createUserForOwnership()).userId,
        });
      const merchantAId = merchantARes.body.merchant.id as string;
      createdMerchantIds.push(merchantAId);

      const merchantBRes = await agent
        .post('/api/catalog/merchants')
        .set('X-CSRF-Token', csrfToken)
        .send({
          name: 'Cross Merchant B',
          vertical: 'FOOD',
          cityId,
          zoneId,
          latitude: -1.9441,
          longitude: 30.0619,
          ownerUserId: (await createUserForOwnership()).userId,
        });
      const merchantBId = merchantBRes.body.merchant.id as string;
      createdMerchantIds.push(merchantBId);

      const categoryRes = await agent
        .post(`/api/catalog/merchants/${merchantAId}/categories`)
        .set('X-CSRF-Token', csrfToken)
        .send({ name: 'Belongs to A' });

      const res = await agent
        .post(`/api/catalog/merchants/${merchantBId}/products`)
        .set('X-CSRF-Token', csrfToken)
        .send({
          categoryId: categoryRes.body.category.id,
          name: 'Cross-merchant product',
          priceMinor: '500',
          currency: 'RWF',
        })
        .expect(400);
      expect(res.body.error.code).toBe('CATEGORY_NOT_IN_MERCHANT');
    });
  });
});
