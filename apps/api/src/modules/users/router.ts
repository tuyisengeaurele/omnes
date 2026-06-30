import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from '../../middleware/auth';
import { requireRole } from '../../middleware/rbac';
import { validate } from '../../middleware/validate';
import { auditLog } from '../../middleware/audit';
import { getPagination, buildPaginatedResponse } from '../../utils/pagination';
import { prisma } from '../../config/prisma';
import { createUserSchema, updateUserSchema } from './schema';
import bcrypt from 'bcryptjs';
import { z } from 'zod';

// Enforce bcrypt 72-byte limit on passwords at the router level
const createUserSchemaWithMaxPassword = createUserSchema.extend({
  password: z.string().min(8).max(72),
});

export const router = Router();

router.use(authenticate, requireRole('ADMIN'));

const USER_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  role: true,
  isActive: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

router.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { page, pageSize, skip } = getPagination(req);
    const search = req.query['search'] as string | undefined;
    const where = search
      ? {
          OR: [
            { firstName: { contains: search, mode: 'insensitive' as const } },
            { lastName: { contains: search, mode: 'insensitive' as const } },
            { email: { contains: search, mode: 'insensitive' as const } },
          ],
        }
      : {};
    const [data, total] = await Promise.all([
      prisma.user.findMany({ where, select: USER_SELECT, skip, take: pageSize, orderBy: { createdAt: 'desc' } }),
      prisma.user.count({ where }),
    ]);
    res.json(buildPaginatedResponse(data, total, page, pageSize));
  } catch (err) {
    next(err);
  }
});

router.post(
  '/',
  validate(createUserSchemaWithMaxPassword),
  auditLog('CREATE', 'User'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { password, ...rest } = req.body as { password: string; email: string; firstName: string; lastName: string; role: string };
      const passwordHash = await bcrypt.hash(password, 12);
      const user = await prisma.user.create({
        data: { ...rest, passwordHash },
        select: USER_SELECT,
      });
      res.status(201).json({ success: true, data: user });
    } catch (err) {
      next(err);
    }
  }
);

router.get('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.params['id'] }, select: USER_SELECT });
    if (!user) { res.status(404).json({ success: false, message: 'User not found' }); return; }
    res.json({ success: true, data: user });
  } catch (err) { next(err); }
});

router.put(
  '/:id',
  validate(updateUserSchema),
  auditLog('UPDATE', 'User'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = await prisma.user.update({
        where: { id: req.params['id'] },
        data: req.body as Record<string, unknown>,
        select: USER_SELECT,
      });
      res.json({ success: true, data: user });
    } catch (err) { next(err); }
  }
);

router.patch(
  '/:id/toggle-status',
  auditLog('TOGGLE_STATUS', 'User'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const current = await prisma.user.findUnique({ where: { id: req.params['id'] } });
      if (!current) { res.status(404).json({ success: false, message: 'User not found' }); return; }
      const updatedUser = await prisma.user.update({
        where: { id: req.params['id'] },
        data: { isActive: !current.isActive },
        select: USER_SELECT,
      });
      if (!updatedUser.isActive) {
        await prisma.refreshToken.updateMany({
          where: { userId: req.params['id'], burned: false },
          data: { burned: true },
        });
      }
      res.json({ success: true, data: updatedUser });
    } catch (err) { next(err); }
  }
);

router.delete(
  '/:id',
  auditLog('DELETE', 'User'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (req.params['id'] === req.user!.id) {
        res.status(400).json({ success: false, message: 'Cannot delete your own account' });
        return;
      }
      await prisma.user.delete({ where: { id: req.params['id'] } });
      res.json({ success: true, data: null });
    } catch (err) { next(err); }
  }
);
