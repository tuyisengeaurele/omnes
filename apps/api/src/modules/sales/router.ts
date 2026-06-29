import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from '../../middleware/auth';
import { requireRole } from '../../middleware/rbac';
import { validate } from '../../middleware/validate';
import { auditLog } from '../../middleware/audit';
import { getPagination, buildPaginatedResponse } from '../../utils/pagination';
import { prisma } from '../../config/prisma';
import {
  createCustomerSchema, updateCustomerSchema,
  createSaleSchema, updateSaleSchema, updateSaleStatusSchema, addSalePaymentSchema,
} from './schema';

export const router = Router();
router.use(authenticate);

// ─── CUSTOMERS ────────────────────────────────────────────────

router.get('/customers', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { page, pageSize, skip } = getPagination(req);
    const search = req.query['search'] as string | undefined;
    const where = search
      ? { OR: [{ name: { contains: search, mode: 'insensitive' as const } }, { code: { contains: search, mode: 'insensitive' as const } }] }
      : {};
    const [data, total] = await Promise.all([
      prisma.customer.findMany({ where, skip, take: pageSize, orderBy: { name: 'asc' } }),
      prisma.customer.count({ where }),
    ]);
    res.json(buildPaginatedResponse(data, total, page, pageSize));
  } catch (err) { next(err); }
});

router.post('/customers', requireRole('ADMIN', 'MANAGER', 'SALES_OFFICER'), validate(createCustomerSchema), auditLog('CREATE', 'Customer'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const customer = await prisma.customer.create({ data: req.body as Record<string, unknown> });
      res.status(201).json({ success: true, data: customer });
    } catch (err) { next(err); }
  }
);

router.put('/customers/:id', requireRole('ADMIN', 'MANAGER', 'SALES_OFFICER'), validate(updateCustomerSchema), auditLog('UPDATE', 'Customer'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const customer = await prisma.customer.update({ where: { id: req.params['id'] }, data: req.body as Record<string, unknown> });
      res.json({ success: true, data: customer });
    } catch (err) { next(err); }
  }
);

// ─── SALES ────────────────────────────────────────────────────

const SALE_INCLUDE = {
  customer: { select: { id: true, name: true, code: true, type: true } },
  items: { include: { product: { select: { id: true, name: true, unit: true } } } },
};

function generateInvoiceNumber(year: number, sequence: number): string {
  return `INV-${year}-${String(sequence).padStart(3, '0')}`;
}

function generateProformaNumber(year: number, sequence: number): string {
  return `PRO-${year}-${String(sequence).padStart(3, '0')}`;
}

router.get('/sales', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { page, pageSize, skip } = getPagination(req);
    const status = req.query['status'] as string | undefined;
    const paymentStatus = req.query['paymentStatus'] as string | undefined;
    const customerId = req.query['customerId'] as string | undefined;
    const where: Record<string, unknown> = {};
    if (status) where['status'] = status;
    if (paymentStatus) where['paymentStatus'] = paymentStatus;
    if (customerId) where['customerId'] = customerId;
    const [data, total] = await Promise.all([
      prisma.sale.findMany({ where, skip, take: pageSize, orderBy: { createdAt: 'desc' }, include: { customer: { select: { name: true, code: true } } } }),
      prisma.sale.count({ where }),
    ]);
    res.json(buildPaginatedResponse(data, total, page, pageSize));
  } catch (err) { next(err); }
});

router.post('/sales', requireRole('ADMIN', 'MANAGER', 'SALES_OFFICER'), validate(createSaleSchema), auditLog('CREATE', 'Sale'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { items, ...saleData } = req.body as { items: Array<{ productId: string; quantity: number; unitPrice: number; totalPrice: number }>; customerId: string; saleDate: string; subtotal: number; vatAmount: number; totalAmount: number; notes?: string };
      const year = new Date().getFullYear();
      const count = await prisma.sale.count();
      const invoiceNumber = generateInvoiceNumber(year, count + 1);
      const proformaNumber = generateProformaNumber(year, count + 1);

      const sale = await prisma.sale.create({
        data: { ...saleData, invoiceNumber, proformaNumber, items: { create: items } },
        include: SALE_INCLUDE,
      });
      res.status(201).json({ success: true, data: sale });
    } catch (err) { next(err); }
  }
);

router.get('/sales/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const sale = await prisma.sale.findUnique({
      where: { id: req.params['id'] },
      include: { ...SALE_INCLUDE, payments: { orderBy: { paymentDate: 'desc' } } },
    });
    if (!sale) { res.status(404).json({ success: false, message: 'Sale not found' }); return; }
    res.json({ success: true, data: sale });
  } catch (err) { next(err); }
});

router.put('/sales/:id', requireRole('ADMIN', 'MANAGER', 'SALES_OFFICER'), validate(updateSaleSchema), auditLog('UPDATE', 'Sale'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { items, ...saleData } = req.body as { items?: Array<Record<string, unknown>>; [key: string]: unknown };
      const sale = await prisma.sale.update({ where: { id: req.params['id'] }, data: saleData as Record<string, unknown>, include: SALE_INCLUDE });
      res.json({ success: true, data: sale });
    } catch (err) { next(err); }
  }
);

router.patch('/sales/:id/status', requireRole('ADMIN', 'MANAGER', 'SALES_OFFICER'), validate(updateSaleStatusSchema), auditLog('UPDATE_STATUS', 'Sale'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { status, deliveryDate } = req.body as { status: string; deliveryDate?: string };
      const data: Record<string, unknown> = { status };
      if (deliveryDate) data['deliveryDate'] = new Date(deliveryDate);
      const sale = await prisma.sale.update({ where: { id: req.params['id'] }, data, include: SALE_INCLUDE });
      res.json({ success: true, data: sale });
    } catch (err) { next(err); }
  }
);

router.post('/sales/:id/payments', requireRole('ADMIN', 'ACCOUNTANT', 'SALES_OFFICER'), validate(addSalePaymentSchema), auditLog('CREATE', 'SalePayment'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { amount, paymentDate, method, reference, notes } = req.body as { amount: number; paymentDate: string; method: string; reference?: string; notes?: string };

      const payment = await prisma.$transaction(async (tx) => {
        const pmt = await tx.salePayment.create({ data: { saleId: req.params['id'], amount, paymentDate: new Date(paymentDate), method, reference, notes } });
        const sale = await tx.sale.findUnique({ where: { id: req.params['id'] } });
        if (sale) {
          const newPaid = Number(sale.amountPaid) + amount;
          const paymentStatus = newPaid >= Number(sale.totalAmount) ? 'PAID' : newPaid > 0 ? 'PARTIAL' : 'UNPAID';
          await tx.sale.update({ where: { id: req.params['id'] }, data: { amountPaid: newPaid, paymentStatus } });
        }
        return pmt;
      });
      res.status(201).json({ success: true, data: payment });
    } catch (err) { next(err); }
  }
);

router.get('/sales/:id/proforma', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const [sale, company] = await Promise.all([
      prisma.sale.findUnique({ where: { id: req.params['id'] }, include: { ...SALE_INCLUDE, payments: true } }),
      prisma.companySettings.findUnique({ where: { id: 'default' } }),
    ]);
    if (!sale) { res.status(404).json({ success: false, message: 'Sale not found' }); return; }
    res.json({ success: true, data: { sale, company } });
  } catch (err) { next(err); }
});

router.get('/sales/:id/invoice', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const [sale, company] = await Promise.all([
      prisma.sale.findUnique({ where: { id: req.params['id'] }, include: { ...SALE_INCLUDE, payments: true } }),
      prisma.companySettings.findUnique({ where: { id: 'default' } }),
    ]);
    if (!sale) { res.status(404).json({ success: false, message: 'Sale not found' }); return; }
    res.json({ success: true, data: { sale, company } });
  } catch (err) { next(err); }
});
