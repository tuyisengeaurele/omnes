import { describe, it, expect, vi, beforeEach } from 'vitest';
import supertest from 'supertest';
import express from 'express';

// Mock rate limiter to pass-through in tests — avoids 429 from authLimiter's max:5
vi.mock('express-rate-limit', () => ({
  default: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  rateLimit: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import { router as authRouter } from './router';
import { prisma } from '../../config/prisma';

// Build a minimal test app using just the auth router
const testApp = express();
testApp.use(express.json());
testApp.use('/auth', authRouter);

const request = supertest(testApp);

describe('POST /auth/login', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 422 if email is missing', async () => {
    const res = await request.post('/auth/login').send({ password: 'Password1!' });
    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
  });

  it('returns 422 if password is missing', async () => {
    const res = await request.post('/auth/login').send({ email: 'test@example.com' });
    expect(res.status).toBe(422);
  });

  it('returns 422 if email format is invalid', async () => {
    const res = await request.post('/auth/login').send({ email: 'not-an-email', password: 'pass' });
    expect(res.status).toBe(422);
  });

  it('returns 401 if user not found', async () => {
    (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const res = await request.post('/auth/login').send({ email: 'x@x.com', password: 'pass' });
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('returns 200 with accessToken on valid credentials', async () => {
    const bcrypt = await import('bcryptjs');
    const hash = await bcrypt.hash('Password1!', 12);
    (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'user-1',
      email: 'admin@omnes.com',
      passwordHash: hash,
      isActive: true,
      role: 'ADMIN',
      firstName: 'Admin',
      lastName: 'User',
    });
    (prisma.user.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (prisma.refreshToken.create as ReturnType<typeof vi.fn>).mockResolvedValue({});
    const res = await request.post('/auth/login').send({ email: 'admin@omnes.com', password: 'Password1!' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.accessToken).toBeDefined();
    expect(res.body.data.refreshToken).toBeDefined();
    expect(res.body.data.user.email).toBe('admin@omnes.com');
  });

  it('returns 401 for inactive user', async () => {
    const bcrypt = await import('bcryptjs');
    const hash = await bcrypt.hash('Password1!', 12);
    (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'user-2',
      email: 'inactive@omnes.com',
      passwordHash: hash,
      isActive: false,
      role: 'ADMIN',
    });
    const res = await request.post('/auth/login').send({ email: 'inactive@omnes.com', password: 'Password1!' });
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('returns 401 for wrong password', async () => {
    const bcrypt = await import('bcryptjs');
    const hash = await bcrypt.hash('CorrectPass1!', 12);
    (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'user-3',
      email: 'user@omnes.com',
      passwordHash: hash,
      isActive: true,
      role: 'STAFF',
    });
    const res = await request.post('/auth/login').send({ email: 'user@omnes.com', password: 'WrongPass1!' });
    expect(res.status).toBe(401);
  });
});

describe('POST /auth/refresh', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 422 when refreshToken is missing from body', async () => {
    const res = await request.post('/auth/refresh').send({});
    // validate(refreshSchema) requires refreshToken string min(1); validate returns 422
    expect(res.status).toBe(422);
  });

  it('returns 401 when refresh token is invalid', async () => {
    (prisma.refreshToken.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const res = await request.post('/auth/refresh').send({ refreshToken: 'invalid-token-value' });
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('returns 401 when token is burned', async () => {
    (prisma.refreshToken.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'rt-1',
      token: 'burned-token',
      userId: 'user-1',
      burned: true,
      expiresAt: new Date(Date.now() + 86400000),
    });
    const res = await request.post('/auth/refresh').send({ refreshToken: 'burned-token' });
    expect(res.status).toBe(401);
  });
});

describe('POST /auth/logout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 200 even without a refresh token', async () => {
    const res = await request.post('/auth/logout').send({});
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('burns the token when provided', async () => {
    (prisma.refreshToken.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 1 });
    const res = await request.post('/auth/logout').send({ refreshToken: 'some-token' });
    expect(res.status).toBe(200);
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { token: 'some-token' },
      data: { burned: true },
    });
  });
});
