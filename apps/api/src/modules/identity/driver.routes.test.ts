/**
 * End-to-end driver provisioning tests: real Express app, real Postgres.
 * There is no driver self-signup in this MVP (see driver.routes.ts's own
 * comment), so this ops-only route is the only way a DriverProfile ever
 * gets created - worth covering directly, not just incidentally through
 * whatever else happens to call it.
 */

import { afterAll, describe, expect, it } from 'vitest';
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
  return `+2507${String(88000000 + phoneCounter).padStart(8, '0')}`;
}

async function loginAgentWithOwnApp(phoneE164: string) {
  const sms = createSpySmsPort();
  const app = createApp({ config, logger, smsPort: sms.port });
  const agent = request.agent(app);
  await agent.post('/api/auth/login/request-otp').send({ phoneE164 }).expect(202);
  const code = sms.lastCodeFor(phoneE164);
  const res = await agent.post('/api/auth/login/verify').send({ phoneE164, code }).expect(200);
  return { agent, csrfToken: res.body.csrfToken as string };
}

describe('driver routes', () => {
  const usedPhones: string[] = [];

  function freshPhone(): string {
    const phone = uniquePhone();
    usedPhones.push(phone);
    return phone;
  }

  async function createOpsAgent() {
    const phone = freshPhone();
    const db = getDb();
    const user = await db.user.create({ data: { phoneE164: phone, displayName: 'Ops' } });
    await db.userRole.create({ data: { userId: user.id, role: 'OPS' } });
    return loginAgentWithOwnApp(phone);
  }

  async function createPlainUser(): Promise<string> {
    const phone = freshPhone();
    const db = getDb();
    await db.user.create({ data: { phoneE164: phone, displayName: 'Prospective Driver' } });
    return phone;
  }

  afterAll(async () => {
    const db = getDb();
    for (const phone of usedPhones) {
      const user = await db.user.findUnique({ where: { phoneE164: phone } });
      if (user) {
        await db.driverProfile.deleteMany({ where: { userId: user.id } });
        await db.refreshToken.deleteMany({ where: { userId: user.id } });
        await db.userRole.deleteMany({ where: { userId: user.id } });
        await db.user.delete({ where: { id: user.id } });
      }
      await db.otpChallenge.deleteMany({ where: { phoneE164: phone } });
    }
    await disconnectDb();
  });

  it('lets ops provision a driver for an existing user', async () => {
    const { agent, csrfToken } = await createOpsAgent();
    const driverPhone = await createPlainUser();
    const db = getDb();
    const driverUser = await db.user.findUniqueOrThrow({ where: { phoneE164: driverPhone } });

    const res = await agent
      .post('/api/drivers')
      .set('X-CSRF-Token', csrfToken)
      .send({ userId: driverUser.id, vehicleType: 'MOTO' })
      .expect(201);

    expect(res.body.driver.userId).toBe(driverUser.id);
    expect(res.body.driver.status).toBe('APPROVED');

    const roles = await db.userRole.findMany({ where: { userId: driverUser.id } });
    expect(roles.map((r) => r.role)).toContain('DRIVER');
  });

  it('rejects provisioning from a non-ops user', async () => {
    const customerPhone = await createPlainUser();
    const db = getDb();
    await db.userRole.create({
      data: {
        userId: (await db.user.findUniqueOrThrow({ where: { phoneE164: customerPhone } })).id,
        role: 'CUSTOMER',
      },
    });
    const { agent, csrfToken } = await loginAgentWithOwnApp(customerPhone);
    const targetPhone = await createPlainUser();
    const target = await db.user.findUniqueOrThrow({ where: { phoneE164: targetPhone } });

    await agent
      .post('/api/drivers')
      .set('X-CSRF-Token', csrfToken)
      .send({ userId: target.id, vehicleType: 'MOTO' })
      .expect(403);
  });

  it('rejects provisioning for a userId that does not exist', async () => {
    const { agent, csrfToken } = await createOpsAgent();

    await agent
      .post('/api/drivers')
      .set('X-CSRF-Token', csrfToken)
      .send({ userId: '00000000-0000-4000-8000-000000000000', vehicleType: 'MOTO' })
      .expect(400);
  });

  it('rejects provisioning the same user twice', async () => {
    const { agent, csrfToken } = await createOpsAgent();
    const driverPhone = await createPlainUser();
    const db = getDb();
    const driverUser = await db.user.findUniqueOrThrow({ where: { phoneE164: driverPhone } });

    await agent
      .post('/api/drivers')
      .set('X-CSRF-Token', csrfToken)
      .send({ userId: driverUser.id, vehicleType: 'MOTO' })
      .expect(201);

    const res = await agent
      .post('/api/drivers')
      .set('X-CSRF-Token', csrfToken)
      .send({ userId: driverUser.id, vehicleType: 'CAR' })
      .expect(400);

    expect(res.body.error.code).toBe('USER_ALREADY_A_DRIVER');
  });

  it('rejects a request with no CSRF token', async () => {
    const { agent } = await createOpsAgent();
    const driverPhone = await createPlainUser();
    const db = getDb();
    const driverUser = await db.user.findUniqueOrThrow({ where: { phoneE164: driverPhone } });

    await agent
      .post('/api/drivers')
      .send({ userId: driverUser.id, vehicleType: 'MOTO' })
      .expect(403);
  });
});
