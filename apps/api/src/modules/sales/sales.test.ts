import { describe, it, expect, vi, beforeEach } from 'vitest';
import supertest from 'supertest';
import express from 'express';
import { router as salesRouter } from './router';
import { prisma } from '../../config/prisma';
import jwt from 'jsonwebtoken';

// Mock rate limiter to pass-through in tests
vi.mock('express-rate-limit', () => ({
  default: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  rateLimit: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

const testApp = express();
testApp.use(express.json());
testApp.use('/api', salesRouter);
// Basic error handler to surface 500 errors in tests
testApp.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(500).json({ success: false, message: err.message, stack: err.stack });
});

const request = supertest(testApp);

const JWT_SECRET = 'test_access_secret_for_tests_only';

function makeAuthHeader(role = 'ADMIN') {
  const token = jwt.sign({ id: 'user-1', email: 'admin@omnes.com', role }, JWT_SECRET);
  return `Bearer ${token}`;
}

describe('GET /api/sales', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('requires authentication', async () => {
    const res = await request.get('/api/sales');
    expect(res.status).toBe(401);
  });

  it('returns paginated sales list for authenticated user', async () => {
    (prisma.sale.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (prisma.sale.count as ReturnType<typeof vi.fn>).mockResolvedValue(0);
    const res = await request
      .get('/api/sales')
      .set('Authorization', makeAuthHeader());
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeInstanceOf(Array);
  });
});

describe('POST /api/sales', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('requires authentication', async () => {
    const res = await request.post('/api/sales').send({});
    expect(res.status).toBe(401);
  });

  it('returns 403 for user with insufficient role', async () => {
    const res = await request
      .post('/api/sales')
      .set('Authorization', makeAuthHeader('STAFF'))
      .send({
        customerId: 'cust-1',
        saleDate: '2024-01-01',
        subtotal: 5000,
        vatAmount: 900,
        totalAmount: 5900,
        items: [{ productId: 'prod-1', quantity: 100, unitPrice: 50, totalPrice: 5000 }],
      });
    expect(res.status).toBe(403);
  });

  it('returns 422 if required fields are missing', async () => {
    const res = await request
      .post('/api/sales')
      .set('Authorization', makeAuthHeader())
      .send({ customerId: 'cust-1' }); // missing items, saleDate, amounts
    expect(res.status).toBe(422);
  });

  it('creates a sale successfully with valid data', async () => {
    (prisma.sale.count as ReturnType<typeof vi.fn>).mockResolvedValue(0);
    (prisma.sale.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'sale-1',
      invoiceNumber: 'INV-2024-001',
      proformaNumber: 'PRO-2024-001',
      customerId: 'cust-1',
      customer: { id: 'cust-1', name: 'Test Customer', code: 'TC001', type: 'COMPANY' },
      items: [],
      status: 'PENDING',
      paymentStatus: 'UNPAID',
      subtotal: 5000,
      vatAmount: 900,
      totalAmount: 5900,
    });
    const res = await request
      .post('/api/sales')
      .set('Authorization', makeAuthHeader())
      .send({
        customerId: 'cust-1',
        saleDate: '2024-01-01',
        subtotal: 5000,
        vatAmount: 900,
        totalAmount: 5900,
        items: [{ productId: 'prod-1', quantity: 100, unitPrice: 50, totalPrice: 5000 }],
      });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.invoiceNumber).toBe('INV-2024-001');
  });

  // TODO: requires stock validation feature (not yet merged into this worktree)
  it.skip('returns 400 if product has insufficient stock', async () => {
    (prisma.productType.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'prod-1',
      name: 'Standard Brick',
      currentStock: 0,
    });
    const res = await request
      .post('/api/sales')
      .set('Authorization', makeAuthHeader())
      .send({
        customerId: 'cust-1',
        saleDate: '2024-01-01',
        subtotal: 5000,
        vatAmount: 900,
        totalAmount: 5900,
        items: [{ productId: 'prod-1', quantity: 100, unitPrice: 50, totalPrice: 5000 }],
      });
    expect([400, 404]).toContain(res.status);
  });
});

describe('GET /api/sales/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 404 for non-existent sale', async () => {
    (prisma.sale.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const res = await request
      .get('/api/sales/nonexistent-id')
      .set('Authorization', makeAuthHeader());
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it('returns sale data when found', async () => {
    (prisma.sale.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'sale-1',
      invoiceNumber: 'INV-2024-001',
      customer: { id: 'cust-1', name: 'Test Customer', code: 'TC001', type: 'COMPANY' },
      items: [],
      payments: [],
    });
    const res = await request
      .get('/api/sales/sale-1')
      .set('Authorization', makeAuthHeader());
    expect(res.status).toBe(200);
    expect(res.body.data.invoiceNumber).toBe('INV-2024-001');
  });
});
