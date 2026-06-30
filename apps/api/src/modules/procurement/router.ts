import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from '../../middleware/auth';
import { requireRole } from '../../middleware/rbac';
import { validate } from '../../middleware/validate';
import { auditLog } from '../../middleware/audit';
import { getPagination, buildPaginatedResponse } from '../../utils/pagination';
import { prisma } from '../../config/prisma';
import {
  createSupplierSchema, updateSupplierSchema,
  createPurchaseOrderSchema, updatePurchaseOrderSchema, updatePOStatusSchema,
  addSupplierPaymentSchema,
} from './schema';

export const router = Router();
router.use(authenticate);

// ─── SUPPLIERS ────────────────────────────────────────────────

router.get('/suppliers', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { page, pageSize, skip } = getPagination(req);
    const search = req.query['search'] as string | undefined;
    const where = search
      ? { OR: [{ name: { contains: search, mode: 'insensitive' as const } }, { code: { contains: search, mode: 'insensitive' as const } }] }
      : {};
    const [data, total] = await Promise.all([
      prisma.supplier.findMany({ where, skip, take: pageSize, orderBy: { name: 'asc' } }),
      prisma.supplier.count({ where }),
    ]);
    res.json(buildPaginatedResponse(data, total, page, pageSize));
  } catch (err) { next(err); }
});

router.post('/suppliers', requireRole('ADMIN', 'MANAGER'), validate(createSupplierSchema), auditLog('CREATE', 'Supplier'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const supplier = await prisma.supplier.create({ data: req.body as Record<string, unknown> });
      res.status(201).json({ success: true, data: supplier });
    } catch (err) { next(err); }
  }
);

router.put('/suppliers/:id', requireRole('ADMIN', 'MANAGER'), validate(updateSupplierSchema), auditLog('UPDATE', 'Supplier'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const supplier = await prisma.supplier.update({ where: { id: req.params['id'] }, data: req.body as Record<string, unknown> });
      res.json({ success: true, data: supplier });
    } catch (err) { next(err); }
  }
);

router.patch('/suppliers/:id/toggle-status', requireRole('ADMIN', 'MANAGER'), auditLog('TOGGLE_STATUS', 'Supplier'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const current = await prisma.supplier.findUnique({ where: { id: req.params['id'] } });
      if (!current) { res.status(404).json({ success: false, message: 'Supplier not found' }); return; }
      const supplier = await prisma.supplier.update({ where: { id: req.params['id'] }, data: { isActive: !current.isActive } });
      res.json({ success: true, data: supplier });
    } catch (err) { next(err); }
  }
);

// ─── PURCHASE ORDERS ──────────────────────────────────────────

const PO_INCLUDE = {
  supplier: { select: { id: true, name: true, code: true } },
  items: { include: { material: { select: { id: true, name: true, code: true, unit: true } } } },
};

router.get('/purchase-orders', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { page, pageSize, skip } = getPagination(req);
    const status = req.query['status'] as string | undefined;
    const supplierId = req.query['supplierId'] as string | undefined;
    const where: Record<string, unknown> = {};
    if (status) where['status'] = status;
    if (supplierId) where['supplierId'] = supplierId;
    const [data, total] = await Promise.all([
      prisma.purchaseOrder.findMany({ where, skip, take: pageSize, orderBy: { createdAt: 'desc' }, include: { supplier: { select: { name: true, code: true } }, _count: { select: { items: true } } } }),
      prisma.purchaseOrder.count({ where }),
    ]);
    res.json(buildPaginatedResponse(data, total, page, pageSize));
  } catch (err) { next(err); }
});

router.post('/purchase-orders', requireRole('ADMIN', 'MANAGER'), validate(createPurchaseOrderSchema), auditLog('CREATE', 'PurchaseOrder'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { items, supplierId, orderDate, expectedDate, notes } = req.body as { items: Array<{ materialId: string; quantity: number; unitPrice: number; totalPrice?: number }>; supplierId: string; orderDate: string; expectedDate?: string; notes?: string };

      const computedTotal = items.reduce((sum: number, item: { quantity: number; unitPrice: number }) => sum + item.quantity * item.unitPrice, 0);

      const itemsWithTotal = items.map(item => ({
        materialId: item.materialId,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        totalPrice: item.quantity * item.unitPrice,
      }));

      const po = await prisma.purchaseOrder.create({
        data: { supplierId, orderDate, expectedDate, notes, totalAmount: computedTotal, poNumber: `PO-${Date.now()}`, items: { create: itemsWithTotal } },
        include: PO_INCLUDE,
      });
      res.status(201).json({ success: true, data: po });
    } catch (err) { next(err); }
  }
);

router.get('/purchase-orders/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const po = await prisma.purchaseOrder.findUnique({
      where: { id: req.params['id'] },
      include: { ...PO_INCLUDE, payments: { orderBy: { paymentDate: 'desc' } } },
    });
    if (!po) { res.status(404).json({ success: false, message: 'Purchase order not found' }); return; }
    res.json({ success: true, data: po });
  } catch (err) { next(err); }
});

router.put('/purchase-orders/:id', requireRole('ADMIN', 'MANAGER'), validate(updatePurchaseOrderSchema), auditLog('UPDATE', 'PurchaseOrder'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { items, ...poData } = req.body as { items?: Array<Record<string, unknown>>; [key: string]: unknown };
      const po = await prisma.purchaseOrder.update({
        where: { id: req.params['id'] },
        data: poData as Record<string, unknown>,
        include: PO_INCLUDE,
      });
      res.json({ success: true, data: po });
    } catch (err) { next(err); }
  }
);

const VALID_PO_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ['SENT', 'CANCELLED'],
  SENT: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['RECEIVED', 'CANCELLED'],
  RECEIVED: [],
  CANCELLED: [],
};

router.patch('/purchase-orders/:id/status', requireRole('ADMIN', 'MANAGER'), validate(updatePOStatusSchema), auditLog('UPDATE_STATUS', 'PurchaseOrder'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { status, receivedDate } = req.body as { status: string; receivedDate?: string };

      const current = await prisma.purchaseOrder.findUnique({ where: { id: req.params['id'] } });
      if (!current) { res.status(404).json({ success: false, message: 'Purchase order not found' }); return; }
      const allowed = VALID_PO_TRANSITIONS[current.status] ?? [];
      if (!allowed.includes(status)) {
        res.status(400).json({
          success: false,
          message: `Cannot transition from ${current.status} to ${status}`,
        });
        return;
      }

      const data: Record<string, unknown> = { status };
      if (receivedDate) data['receivedDate'] = new Date(receivedDate);

      const po = await prisma.purchaseOrder.update({ where: { id: req.params['id'] }, data, include: { supplier: { select: { name: true } } } });

      if (status === 'RECEIVED') {
        const items = await prisma.purchaseItem.findMany({ where: { poId: req.params['id'] } });
        for (const item of items) {
          await prisma.rawMaterial.update({ where: { id: item.materialId }, data: { currentStock: { increment: Number(item.quantity) } } });
          await prisma.stockMovement.create({ data: { materialId: item.materialId, type: 'IN', quantity: Number(item.quantity), reference: po.poNumber, notes: 'PO received' } });
          await prisma.purchaseItem.update({ where: { id: item.id }, data: { received: item.quantity } });
        }
      }
      res.json({ success: true, data: po });
    } catch (err) { next(err); }
  }
);

router.post('/purchase-orders/:id/payments', requireRole('ADMIN', 'ACCOUNTANT'), validate(addSupplierPaymentSchema), auditLog('CREATE', 'SupplierPayment'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const payment = await prisma.supplierPayment.create({ data: { poId: req.params['id'], ...(req.body as Record<string, unknown>) } });
      res.status(201).json({ success: true, data: payment });
    } catch (err) { next(err); }
  }
);
