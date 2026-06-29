import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from '../../middleware/auth';
import { requireRole } from '../../middleware/rbac';
import { validate } from '../../middleware/validate';
import { auditLog } from '../../middleware/audit';
import { getPagination, buildPaginatedResponse } from '../../utils/pagination';
import { prisma } from '../../config/prisma';
import {
  createProductTypeSchema, updateProductTypeSchema,
  createKilnSchema, updateKilnSchema,
  createBatchSchema, updateBatchSchema, updateBatchStatusSchema,
  createBatchOutputSchema, createMaterialUsageSchema,
} from './schema';

export const router = Router();
router.use(authenticate);

// ─── PRODUCT TYPES ────────────────────────────────────────────

router.get('/product-types', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { page, pageSize, skip } = getPagination(req);
    const search = req.query['search'] as string | undefined;
    const where = search ? { name: { contains: search, mode: 'insensitive' as const } } : {};
    const [data, total] = await Promise.all([
      prisma.productType.findMany({ where, skip, take: pageSize, orderBy: { name: 'asc' } }),
      prisma.productType.count({ where }),
    ]);
    res.json(buildPaginatedResponse(data, total, page, pageSize));
  } catch (err) { next(err); }
});

router.post('/product-types', requireRole('ADMIN', 'MANAGER', 'PRODUCTION_SUPERVISOR'), validate(createProductTypeSchema), auditLog('CREATE', 'ProductType'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const pt = await prisma.productType.create({ data: req.body as Record<string, unknown> });
      res.status(201).json({ success: true, data: pt });
    } catch (err) { next(err); }
  }
);

router.put('/product-types/:id', requireRole('ADMIN', 'MANAGER', 'PRODUCTION_SUPERVISOR'), validate(updateProductTypeSchema), auditLog('UPDATE', 'ProductType'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const pt = await prisma.productType.update({ where: { id: req.params['id'] }, data: req.body as Record<string, unknown> });
      res.json({ success: true, data: pt });
    } catch (err) { next(err); }
  }
);

router.delete('/product-types/:id', requireRole('ADMIN'), auditLog('DELETE', 'ProductType'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await prisma.productType.delete({ where: { id: req.params['id'] } });
      res.json({ success: true, data: null });
    } catch (err) { next(err); }
  }
);

// ─── KILNS ────────────────────────────────────────────────────

router.get('/kilns', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { page, pageSize, skip } = getPagination(req);
    const [data, total] = await Promise.all([
      prisma.kiln.findMany({ skip, take: pageSize, orderBy: { name: 'asc' }, include: { _count: { select: { batches: true } } } }),
      prisma.kiln.count(),
    ]);
    res.json(buildPaginatedResponse(data, total, page, pageSize));
  } catch (err) { next(err); }
});

router.post('/kilns', requireRole('ADMIN', 'MANAGER'), validate(createKilnSchema), auditLog('CREATE', 'Kiln'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const kiln = await prisma.kiln.create({ data: req.body as Record<string, unknown> });
      res.status(201).json({ success: true, data: kiln });
    } catch (err) { next(err); }
  }
);

router.put('/kilns/:id', requireRole('ADMIN', 'MANAGER'), validate(updateKilnSchema), auditLog('UPDATE', 'Kiln'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const kiln = await prisma.kiln.update({ where: { id: req.params['id'] }, data: req.body as Record<string, unknown> });
      res.json({ success: true, data: kiln });
    } catch (err) { next(err); }
  }
);

// ─── PRODUCTION BATCHES ───────────────────────────────────────

const BATCH_INCLUDE = {
  kiln: { select: { id: true, name: true } },
  outputs: { include: { product: { select: { id: true, name: true, unit: true } } } },
};

router.get('/batches', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { page, pageSize, skip } = getPagination(req);
    const status = req.query['status'] as string | undefined;
    const kilnId = req.query['kilnId'] as string | undefined;
    const where: Record<string, unknown> = {};
    if (status) where['status'] = status;
    if (kilnId) where['kilnId'] = kilnId;
    const [data, total] = await Promise.all([
      prisma.productionBatch.findMany({ where, skip, take: pageSize, orderBy: { createdAt: 'desc' }, include: { kiln: { select: { id: true, name: true } } } }),
      prisma.productionBatch.count({ where }),
    ]);
    res.json(buildPaginatedResponse(data, total, page, pageSize));
  } catch (err) { next(err); }
});

router.post('/batches', requireRole('ADMIN', 'MANAGER', 'PRODUCTION_SUPERVISOR'), validate(createBatchSchema), auditLog('CREATE', 'ProductionBatch'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const batch = await prisma.productionBatch.create({ data: req.body as Record<string, unknown>, include: BATCH_INCLUDE });
      res.status(201).json({ success: true, data: batch });
    } catch (err) { next(err); }
  }
);

router.get('/batches/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const batch = await prisma.productionBatch.findUnique({
      where: { id: req.params['id'] },
      include: {
        ...BATCH_INCLUDE,
        materialUsages: { include: { material: { select: { id: true, name: true, unit: true, code: true } } } },
      },
    });
    if (!batch) { res.status(404).json({ success: false, message: 'Batch not found' }); return; }
    res.json({ success: true, data: batch });
  } catch (err) { next(err); }
});

router.put('/batches/:id', requireRole('ADMIN', 'MANAGER', 'PRODUCTION_SUPERVISOR'), validate(updateBatchSchema), auditLog('UPDATE', 'ProductionBatch'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const batch = await prisma.productionBatch.update({ where: { id: req.params['id'] }, data: req.body as Record<string, unknown>, include: BATCH_INCLUDE });
      res.json({ success: true, data: batch });
    } catch (err) { next(err); }
  }
);

router.patch('/batches/:id/status', requireRole('ADMIN', 'MANAGER', 'PRODUCTION_SUPERVISOR'), validate(updateBatchStatusSchema), auditLog('UPDATE_STATUS', 'ProductionBatch'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const batch = await prisma.productionBatch.update({
        where: { id: req.params['id'] },
        data: { status: req.body.status as string },
        include: BATCH_INCLUDE,
      });
      res.json({ success: true, data: batch });
    } catch (err) { next(err); }
  }
);

router.post('/batches/:id/outputs', requireRole('ADMIN', 'MANAGER', 'PRODUCTION_SUPERVISOR'), validate(createBatchOutputSchema), auditLog('CREATE', 'BatchOutput'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const output = await prisma.batchOutput.create({
        data: { batchId: req.params['id'], ...(req.body as Record<string, unknown>) },
        include: { product: { select: { name: true, unit: true } } },
      });
      res.status(201).json({ success: true, data: output });
    } catch (err) { next(err); }
  }
);

router.post('/batches/:id/materials', requireRole('ADMIN', 'MANAGER', 'PRODUCTION_SUPERVISOR'), validate(createMaterialUsageSchema), auditLog('CREATE', 'MaterialUsage'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { materialId, quantity } = req.body as { materialId: string; quantity: number };
      const usage = await prisma.$transaction(async (tx) => {
        const u = await tx.materialUsage.create({
          data: { batchId: req.params['id'], materialId, quantity },
          include: { material: { select: { name: true, unit: true } } },
        });
        await tx.rawMaterial.update({
          where: { id: materialId },
          data: { currentStock: { decrement: quantity } },
        });
        await tx.stockMovement.create({
          data: { materialId, type: 'OUT', quantity, reference: `BATCH-${req.params['id']}`, notes: 'Production usage' },
        });
        return u;
      });
      res.status(201).json({ success: true, data: usage });
    } catch (err) { next(err); }
  }
);
