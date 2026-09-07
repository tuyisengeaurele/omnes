/**
 * End-to-end integration tests: real Express app, real middleware stack,
 * real Postgres (omnes_test, see vitest.setup.ts), a fake SmsPort standing
 * in for the one real external dependency. This is what proves the pieces
 * unit tested in isolation (otp.service, token.service) are actually wired
 * together correctly behind real HTTP, real cookies, and real CSRF headers.
 *
 * Requires apps/api/.env.test to exist and point at a migrated omnes_test
 * database. See .env.test.example.
 */

import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from './app.js';
import { getConfig } from './platform/config.js';
import { getLogger } from './platform/logger.js';
import { getDb, disconnectDb } from './platform/db.js';
import type { SendSmsInput, SendSmsResult, SmsPort } from './adapters/sms/index.js';

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
    messages,
    lastCodeFor(phoneE164: string): string {
      const match = [...messages].reverse().find((m) => m.to === phoneE164);
      if (!match) throw new Error(`no sms sent to ${phoneE164}`);
      const code = /\d{4,10}/.exec(match.body);
      if (!code) throw new Error(`no code found in sms body: ${match.body}`);
      return code[0];
    },
  };
}

let phoneCounter = 0;
function uniquePhone(): string {
  phoneCounter += 1;
  return `+2507${String(80000000 + phoneCounter).padStart(8, '0')}`;
}

const config = getConfig();
const logger = getLogger();

async function cleanupPhone(phoneE164: string): Promise<void> {
  const db = getDb();
  const user = await db.user.findUnique({ where: { phoneE164 } });
  if (user) {
    await db.refreshToken.deleteMany({ where: { userId: user.id } });
    await db.userRole.deleteMany({ where: { userId: user.id } });
    await db.credential.deleteMany({ where: { userId: user.id } });
    await db.user.delete({ where: { id: user.id } });
  }
  await db.otpChallenge.deleteMany({ where: { phoneE164 } });
}

describe('identity routes', () => {
  const usedPhones: string[] = [];

  function freshPhone(): string {
    const phone = uniquePhone();
    usedPhones.push(phone);
    return phone;
  }

  afterAll(async () => {
    await Promise.all(usedPhones.map(cleanupPhone));
    await disconnectDb();
  });

  describe('registration', () => {
    it('registers a new customer end to end', async () => {
      const sms = createSpySmsPort();
      const app = createApp({ config, logger, smsPort: sms.port });
      const phone = freshPhone();

      await request(app)
        .post('/api/auth/register/request-otp')
        .send({ phoneE164: phone })
        .expect(202);

      const code = sms.lastCodeFor(phone);

      const verifyRes = await request(app)
        .post('/api/auth/register/verify')
        .send({ phoneE164: phone, displayName: 'Test Customer', code })
        .expect(201);

      expect(verifyRes.body.user.phoneE164).toBe(phone);
      expect(verifyRes.body.csrfToken).toBeTruthy();

      const cookies = verifyRes.get('Set-Cookie') ?? [];
      expect(cookies.some((c) => c.startsWith('omnes_at_cust=') && c.includes('HttpOnly'))).toBe(
        true
      );
      expect(cookies.some((c) => c.startsWith('omnes_rt_cust=') && c.includes('HttpOnly'))).toBe(
        true
      );
      // The CSRF cookie must not be httpOnly - the double-submit pattern
      // needs client JS to read it back.
      const csrfCookie = cookies.find((c) => c.startsWith('omnes_csrf_cust='));
      expect(csrfCookie).toBeTruthy();
      expect(csrfCookie).not.toContain('HttpOnly');
    });

    it('rejects registration with the wrong code', async () => {
      const sms = createSpySmsPort();
      const app = createApp({ config, logger, smsPort: sms.port });
      const phone = freshPhone();

      await request(app).post('/api/auth/register/request-otp').send({ phoneE164: phone });

      const res = await request(app)
        .post('/api/auth/register/verify')
        .send({ phoneE164: phone, displayName: 'Test Customer', code: '000000' })
        .expect(400);

      expect(res.body.error.code).toBe('REGISTRATION_FAILED');
    });

    it('refuses to issue a second registration code for an already-registered phone', async () => {
      const sms = createSpySmsPort();
      const app = createApp({ config, logger, smsPort: sms.port });
      const phone = freshPhone();

      await request(app).post('/api/auth/register/request-otp').send({ phoneE164: phone });
      const code = sms.lastCodeFor(phone);
      await request(app)
        .post('/api/auth/register/verify')
        .send({ phoneE164: phone, displayName: 'Test Customer', code })
        .expect(201);

      const res = await request(app)
        .post('/api/auth/register/request-otp')
        .send({ phoneE164: phone })
        .expect(400);
      expect(res.body.error.code).toBe('ALREADY_REGISTERED');
    });

    it('rejects a malformed phone number before touching the database', async () => {
      const sms = createSpySmsPort();
      const app = createApp({ config, logger, smsPort: sms.port });

      const res = await request(app)
        .post('/api/auth/register/request-otp')
        .send({ phoneE164: 'not-a-phone-number' })
        .expect(400);

      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect(sms.messages).toHaveLength(0);
    });
  });

  describe('login', () => {
    async function registerFreshUser() {
      const sms = createSpySmsPort();
      const app = createApp({ config, logger, smsPort: sms.port });
      const phone = freshPhone();

      await request(app).post('/api/auth/register/request-otp').send({ phoneE164: phone });
      const code = sms.lastCodeFor(phone);
      await request(app)
        .post('/api/auth/register/verify')
        .send({ phoneE164: phone, displayName: 'Test Customer', code });

      return { phone, sms, app };
    }

    it('logs an existing customer in end to end', async () => {
      const { phone, sms, app } = await registerFreshUser();

      await request(app).post('/api/auth/login/request-otp').send({ phoneE164: phone }).expect(202);
      const code = sms.lastCodeFor(phone);

      const res = await request(app)
        .post('/api/auth/login/verify')
        .send({ phoneE164: phone, code })
        .expect(200);

      expect(res.body.user.phoneE164).toBe(phone);
    });

    it('does not reveal via status code whether a phone is registered', async () => {
      const sms = createSpySmsPort();
      const app = createApp({ config, logger, smsPort: sms.port });
      const unregisteredPhone = freshPhone();

      const res = await request(app)
        .post('/api/auth/login/request-otp')
        .send({ phoneE164: unregisteredPhone })
        .expect(202);

      expect(res.body.status).toBe('otp_sent');
      // No code was actually sent, since there is no account to notify.
      expect(sms.messages).toHaveLength(0);
    });
  });

  describe('session lifecycle', () => {
    async function loggedInAgent() {
      const sms = createSpySmsPort();
      const app = createApp({ config, logger, smsPort: sms.port });
      const phone = freshPhone();
      const agent = request.agent(app);

      await agent.post('/api/auth/register/request-otp').send({ phoneE164: phone });
      const code = sms.lastCodeFor(phone);
      const res = await agent
        .post('/api/auth/register/verify')
        .send({ phoneE164: phone, displayName: 'Test Customer', code });

      return { agent, app, phone, csrfToken: res.body.csrfToken as string };
    }

    it('allows /me with a valid session', async () => {
      const { agent, phone } = await loggedInAgent();
      const res = await agent.get('/api/auth/me').expect(200);
      expect(res.body.user.phoneE164).toBe(phone);
      expect(res.body.roles).toContain('CUSTOMER');
    });

    it('rejects /me with no session', async () => {
      const app = createApp({ config, logger, smsPort: createSpySmsPort().port });
      const res = await request(app).get('/api/auth/me').expect(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('rotates the session on refresh', async () => {
      const { agent, csrfToken } = await loggedInAgent();
      const res = await agent.post('/api/auth/refresh').set('X-CSRF-Token', csrfToken).expect(200);
      expect(res.body.csrfToken).toBeTruthy();
      expect(res.body.csrfToken).not.toBe(csrfToken);

      // The rotated session still authenticates.
      await agent.get('/api/auth/me').expect(200);
    });

    it('rejects a refresh request with no CSRF header', async () => {
      const { agent } = await loggedInAgent();
      const res = await agent.post('/api/auth/refresh').expect(403);
      expect(res.body.error.code).toBe('CSRF_TOKEN_INVALID');
    });

    it('rejects a refresh request with the wrong CSRF token', async () => {
      const { agent } = await loggedInAgent();
      const res = await agent
        .post('/api/auth/refresh')
        .set('X-CSRF-Token', 'not-the-real-token')
        .expect(403);
      expect(res.body.error.code).toBe('CSRF_TOKEN_INVALID');
    });

    it('ends the session on logout, so /me afterward is unauthenticated', async () => {
      const { agent, csrfToken } = await loggedInAgent();
      await agent.post('/api/auth/logout').set('X-CSRF-Token', csrfToken).expect(204);
      await agent.get('/api/auth/me').expect(401);
    });
  });

  describe('unmatched routes', () => {
    it('returns a structured 404 for an unknown path', async () => {
      const app = createApp({ config, logger, smsPort: createSpySmsPort().port });
      const res = await request(app).get('/api/does-not-exist').expect(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });
});
