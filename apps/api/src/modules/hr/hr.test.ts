import { describe, it, expect, vi, beforeEach } from 'vitest';
import supertest from 'supertest';
import express from 'express';
import { router as hrRouter } from './router';
import { prisma } from '../../config/prisma';
import jwt from 'jsonwebtoken';

// Mock rate limiter to pass-through in tests
vi.mock('express-rate-limit', () => ({
  default: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  rateLimit: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

const testApp = express();
testApp.use(express.json());
testApp.use('/api', hrRouter);
// Error handler to surface 500 errors
testApp.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(500).json({ success: false, message: err.message });
});

const request = supertest(testApp);

const JWT_SECRET = 'test_access_secret_for_tests_only';

function makeAuthHeader(role = 'ADMIN') {
  return `Bearer ${jwt.sign({ id: 'user-1', email: 'admin@omnes.com', role }, JWT_SECRET)}`;
}

describe('POST /api/payroll/run', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('requires authentication', async () => {
    const res = await request.post('/api/payroll/run').send({ month: 1, year: 2024 });
    expect(res.status).toBe(401);
  });

  it('returns 422 with invalid month (too high)', async () => {
    const res = await request
      .post('/api/payroll/run')
      .set('Authorization', makeAuthHeader())
      .send({ month: 13, year: 2024 });
    expect(res.status).toBe(422);
  });

  it('returns 422 with invalid month (zero)', async () => {
    const res = await request
      .post('/api/payroll/run')
      .set('Authorization', makeAuthHeader())
      .send({ month: 0, year: 2024 });
    expect(res.status).toBe(422);
  });

  it('returns 422 with invalid year (before 2020)', async () => {
    const res = await request
      .post('/api/payroll/run')
      .set('Authorization', makeAuthHeader())
      .send({ month: 1, year: 2019 });
    expect(res.status).toBe(422);
  });

  it('returns 403 for user with insufficient role', async () => {
    const res = await request
      .post('/api/payroll/run')
      .set('Authorization', makeAuthHeader('STAFF'))
      .send({ month: 1, year: 2024 });
    expect(res.status).toBe(403);
  });

  it('creates payroll run successfully with valid data and active employees', async () => {
    (prisma.employee.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'emp-1', firstName: 'Alice', lastName: 'Smith', salary: 500000, status: 'ACTIVE' },
      { id: 'emp-2', firstName: 'Bob', lastName: 'Jones', salary: 450000, status: 'ACTIVE' },
    ]);
    (prisma.payrollRun.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'run-1',
      month: 6,
      year: 2024,
      totalAmount: 950000,
      status: 'DRAFT',
      entries: [
        { id: 'e-1', employeeId: 'emp-1', grossSalary: 500000, netSalary: 500000, employee: { firstName: 'Alice', lastName: 'Smith', bankName: 'BK', bankAccountNumber: '001' } },
        { id: 'e-2', employeeId: 'emp-2', grossSalary: 450000, netSalary: 450000, employee: { firstName: 'Bob', lastName: 'Jones', bankName: 'BK', bankAccountNumber: '002' } },
      ],
    });
    const res = await request
      .post('/api/payroll/run')
      .set('Authorization', makeAuthHeader())
      .send({ month: 6, year: 2024 });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.totalAmount).toBe(950000);
    expect(res.body.data.status).toBe('DRAFT');
  });

  it('creates payroll run with zero total when no active employees', async () => {
    (prisma.employee.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (prisma.payrollRun.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'run-2',
      month: 6,
      year: 2024,
      totalAmount: 0,
      status: 'DRAFT',
      entries: [],
    });
    const res = await request
      .post('/api/payroll/run')
      .set('Authorization', makeAuthHeader())
      .send({ month: 6, year: 2024 });
    expect(res.status).toBe(201);
    expect(res.body.data.totalAmount).toBe(0);
  });

  // TODO: requires duplicate payroll prevention feature (not yet merged into this worktree)
  it.skip('returns 409 when payroll for same month/year already exists', async () => {
    (prisma.payrollRun.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'existing-run',
      month: 6,
      year: 2024,
    });
    const res = await request
      .post('/api/payroll/run')
      .set('Authorization', makeAuthHeader())
      .send({ month: 6, year: 2024 });
    expect(res.status).toBe(409);
  });
});

describe('GET /api/payroll', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('requires authentication', async () => {
    const res = await request.get('/api/payroll');
    expect(res.status).toBe(401);
  });

  it('returns paginated payroll runs for authenticated user', async () => {
    (prisma.payrollRun.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (prisma.payrollRun.count as ReturnType<typeof vi.fn>).mockResolvedValue(0);
    const res = await request
      .get('/api/payroll')
      .set('Authorization', makeAuthHeader());
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeInstanceOf(Array);
  });
});

describe('GET /api/payroll/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 404 for non-existent payroll run', async () => {
    (prisma.payrollRun.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const res = await request
      .get('/api/payroll/nonexistent-id')
      .set('Authorization', makeAuthHeader());
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });
});
