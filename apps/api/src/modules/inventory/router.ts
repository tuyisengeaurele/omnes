import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from '../../middleware/auth';
import { requireRole } from '../../middleware/rbac';
import { validate } from '../../middleware/validate';
import { auditLog } from '../../middleware/audit';
import { getPagination, buildPaginatedResponse } from '../../utils/pagination';
import { prisma } from '../../config/prisma';
import { createMaterialSchema, updateMaterialSchema, createStockMovementSchema } from './schema';

export const router = Router();
router.use(authenticate);

router.get('/materials/low-stock', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const data = await prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT * FROM "RawMaterial" WHERE "currentStock" <= "reorderLevel" ORDER BY name
    `;
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

router.get('/materials', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { page, pageSize, skip } = getPagination(req);
    const search = req.query['search'] as string | undefined;
    const where = search
      ? { OR: [{ name: { contains: search, mode: 'insensitive' as const } }, { code: { contains: search, mode: 'insensitive' as const } }] }
      : {};
    const [data, total] = await Promise.all([
      prisma.rawMaterial.findMany({ where, skip, take: pageSize, orderBy: { name: 'asc' } }),
      prisma.rawMaterial.count({ where }),
    ]);
    res.json(buildPaginatedResponse(data, total, page, pageSize));
  } catch (err) { next(err); }
});

router.post('/materials', requireRole('ADMIN', 'MANAGER'), validate(createMaterialSchema), auditLog('CREATE', 'RawMaterial'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const mat = await prisma.rawMaterial.create({ data: req.body as Record<string, unknown> });
      res.status(201).json({ success: true, data: mat });
    } catch (err) { next(err); }
  }
);

router.get('/materials/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const mat = await prisma.rawMaterial.findUnique({
      where: { id: req.params['id'] },
      include: { movements: { orderBy: { createdAt: 'desc' }, take: 20 } },
    });
    if (!mat) { res.status(404).json({ success: false, message: 'Material not found' }); return; }
    res.json({ success: true, data: mat });
  } catch (err) { next(err); }
});

router.put('/materials/:id', requireRole('ADMIN', 'MANAGER'), validate(updateMaterialSchema), auditLog('UPDATE', 'RawMaterial'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const mat = await prisma.rawMaterial.update({ where: { id: req.params['id'] }, data: req.body as Record<string, unknown> });
      res.json({ success: true, data: mat });
    } catch (err) { next(err); }
  }
);

router.post('/stock-movements', requireRole('ADMIN', 'MANAGER', 'PRODUCTION_SUPERVISOR'), validate(createStockMovementSchema), auditLog('CREATE', 'StockMovement'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { materialId, type, quantity, reference, notes } = req.body as { materialId: string; type: 'IN' | 'OUT' | 'ADJUSTMENT'; quantity: number; reference?: string; notes?: string };
      const movement = await prisma.$transaction(async (tx) => {
        const mv = await tx.stockMovement.create({ data: { materialId, type, quantity, reference, notes } });
        const delta = type === 'IN' ? quantity : type === 'OUT' ? -quantity : quantity;
        await tx.rawMaterial.update({ where: { id: materialId }, data: { currentStock: { increment: delta } } });
        return mv;
      });
      res.status(201).json({ success: true, data: movement });
    } catch (err) { next(err); }
  }
);

router.get('/stock-movements', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { page, pageSize, skip } = getPagination(req);
    const materialId = req.query['materialId'] as string | undefined;
    const where = materialId ? { materialId } : {};
    const [data, total] = await Promise.all([
      prisma.stockMovement.findMany({ where, skip, take: pageSize, orderBy: { createdAt: 'desc' }, include: { material: { select: { name: true, code: true, unit: true } } } }),
      prisma.stockMovement.count({ where }),
    ]);
    res.json(buildPaginatedResponse(data, total, page, pageSize));
  } catch (err) { next(err); }
});
