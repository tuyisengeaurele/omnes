import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from '../../middleware/auth';
import { requireRole } from '../../middleware/rbac';
import { validate } from '../../middleware/validate';
import { auditLog } from '../../middleware/audit';
import { getPagination, buildPaginatedResponse } from '../../utils/pagination';
import { prisma } from '../../config/prisma';
import { updateCompanySettingsSchema } from './schema';

export const router = Router();
router.use(authenticate);

router.get('/company-settings', async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    let settings = await prisma.companySettings.findFirst();
    if (!settings) {
      settings = await prisma.companySettings.create({ data: { name: 'OMNES Brick Manufacturing' } });
    }
    res.json({ success: true, data: settings });
  } catch (err) { next(err); }
});

router.put(
  '/company-settings',
  requireRole('ADMIN'),
  validate(updateCompanySettingsSchema),
  auditLog('UPDATE', 'CompanySettings'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      let settings = await prisma.companySettings.findFirst();
      if (!settings) {
        settings = await prisma.companySettings.create({ data: { name: 'OMNES Brick Manufacturing', ...req.body } });
      } else {
        settings = await prisma.companySettings.update({ where: { id: settings.id }, data: req.body as Record<string, unknown> });
      }
      res.json({ success: true, data: settings });
    } catch (err) { next(err); }
  }
);

router.get(
  '/audit-logs',
  requireRole('ADMIN'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { page, pageSize, skip } = getPagination(req);
      const search = req.query['search'] as string | undefined;
      const where = search
        ? {
            OR: [
              { action: { contains: search, mode: 'insensitive' as const } },
              { entity: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {};
      const [data, total] = await Promise.all([
        prisma.auditLog.findMany({
          where,
          include: { user: { select: { firstName: true, lastName: true, email: true } } },
          skip,
          take: pageSize,
          orderBy: { createdAt: 'desc' },
        }),
        prisma.auditLog.count({ where }),
      ]);
      res.json(buildPaginatedResponse(data, total, page, pageSize));
    } catch (err) { next(err); }
  }
);
