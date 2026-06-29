import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from '../../middleware/auth';
import { requireRole } from '../../middleware/rbac';
import { validate } from '../../middleware/validate';
import { auditLog } from '../../middleware/audit';
import { getPagination, buildPaginatedResponse } from '../../utils/pagination';
import { prisma } from '../../config/prisma';
import { createAssetSchema, updateAssetSchema, createMaintenanceLogSchema, updateMaintenanceLogSchema, updateMaintenanceStatusSchema } from './schema';

export const router = Router();
router.use(authenticate);

// ─── FIXED ASSETS ─────────────────────────────────────────────

router.get('/fixed-assets', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { page, pageSize, skip } = getPagination(req);
    const status = req.query['status'] as string | undefined;
    const category = req.query['category'] as string | undefined;
    const where: Record<string, unknown> = {};
    if (status) where['status'] = status;
    if (category) where['category'] = category;
    const [data, total] = await Promise.all([
      prisma.fixedAsset.findMany({ where, skip, take: pageSize, orderBy: { assetNumber: 'asc' } }),
      prisma.fixedAsset.count({ where }),
    ]);
    res.json(buildPaginatedResponse(data, total, page, pageSize));
  } catch (err) { next(err); }
});

router.post('/fixed-assets', requireRole('ADMIN', 'MANAGER'), validate(createAssetSchema), auditLog('CREATE', 'FixedAsset'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const asset = await prisma.fixedAsset.create({ data: req.body as Record<string, unknown> });
      res.status(201).json({ success: true, data: asset });
    } catch (err) { next(err); }
  }
);

router.put('/fixed-assets/:id', requireRole('ADMIN', 'MANAGER'), validate(updateAssetSchema), auditLog('UPDATE', 'FixedAsset'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const asset = await prisma.fixedAsset.update({ where: { id: req.params['id'] }, data: req.body as Record<string, unknown> });
      res.json({ success: true, data: asset });
    } catch (err) { next(err); }
  }
);

router.patch('/fixed-assets/:id/dispose', requireRole('ADMIN'), auditLog('DISPOSE', 'FixedAsset'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const asset = await prisma.fixedAsset.update({ where: { id: req.params['id'] }, data: { status: 'DISPOSED' } });
      res.json({ success: true, data: asset });
    } catch (err) { next(err); }
  }
);

// ─── MAINTENANCE LOGS ─────────────────────────────────────────

router.get('/maintenance-logs', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { page, pageSize, skip } = getPagination(req);
    const assetId = req.query['assetId'] as string | undefined;
    const kilnId = req.query['kilnId'] as string | undefined;
    const status = req.query['status'] as string | undefined;
    const where: Record<string, unknown> = {};
    if (assetId) where['assetId'] = assetId;
    if (kilnId) where['kilnId'] = kilnId;
    if (status) where['status'] = status;
    const [data, total] = await Promise.all([
      prisma.maintenanceLog.findMany({ where, skip, take: pageSize, orderBy: { scheduledAt: 'asc' }, include: { asset: { select: { id: true, name: true, assetNumber: true } }, kiln: { select: { id: true, name: true } } } }),
      prisma.maintenanceLog.count({ where }),
    ]);
    res.json(buildPaginatedResponse(data, total, page, pageSize));
  } catch (err) { next(err); }
});

router.post('/maintenance-logs', requireRole('ADMIN', 'MANAGER'), validate(createMaintenanceLogSchema), auditLog('CREATE', 'MaintenanceLog'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const log = await prisma.maintenanceLog.create({ data: req.body as Record<string, unknown>, include: { asset: { select: { name: true } }, kiln: { select: { name: true } } } });
      res.status(201).json({ success: true, data: log });
    } catch (err) { next(err); }
  }
);

router.put('/maintenance-logs/:id', requireRole('ADMIN', 'MANAGER'), validate(updateMaintenanceLogSchema), auditLog('UPDATE', 'MaintenanceLog'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const log = await prisma.maintenanceLog.update({ where: { id: req.params['id'] }, data: req.body as Record<string, unknown> });
      res.json({ success: true, data: log });
    } catch (err) { next(err); }
  }
);

router.patch('/maintenance-logs/:id/status', requireRole('ADMIN', 'MANAGER'), validate(updateMaintenanceStatusSchema), auditLog('UPDATE_STATUS', 'MaintenanceLog'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { status, completedAt, cost } = req.body as { status: string; completedAt?: string; cost?: number };
      const data: Record<string, unknown> = { status };
      if (completedAt) data['completedAt'] = new Date(completedAt);
      if (cost !== undefined) data['cost'] = cost;
      const log = await prisma.maintenanceLog.update({ where: { id: req.params['id'] }, data });
      res.json({ success: true, data: log });
    } catch (err) { next(err); }
  }
);
