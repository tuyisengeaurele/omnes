import { Router, Request, Response, NextFunction } from 'express';
import { validate } from '../../middleware/validate';
import { authenticate } from '../../middleware/auth';
import { authLimiter } from '../../middleware/rateLimiter';
import { loginSchema, refreshSchema, changePasswordSchema } from './schema';
import {
  loginUser,
  rotateRefreshToken,
  burnRefreshToken,
  changeUserPassword,
} from './service';
import { prisma } from '../../config/prisma';

export const router = Router();

router.post(
  '/login',
  authLimiter,
  validate(loginSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await loginUser(req.body.email, req.body.password);
      if (!result) {
        res.status(401).json({ success: false, message: 'Invalid email or password' });
        return;
      }
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/refresh',
  authLimiter,
  validate(refreshSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await rotateRefreshToken(req.body.refreshToken);
      if (!result) {
        res.status(401).json({ success: false, message: 'Invalid or expired refresh token' });
        return;
      }
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/logout',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { refreshToken } = req.body as { refreshToken?: string };
      if (refreshToken) {
        await burnRefreshToken(refreshToken);
      }
      res.json({ success: true, data: null });
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/me',
  authenticate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = await prisma.user.findUnique({
        where: { id: req.user!.id },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          isActive: true,
          lastLoginAt: true,
          createdAt: true,
        },
      });
      res.json({ success: true, data: user });
    } catch (err) {
      next(err);
    }
  }
);

router.put(
  '/change-password',
  authenticate,
  validate(changePasswordSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ok = await changeUserPassword(
        req.user!.id,
        req.body.currentPassword,
        req.body.newPassword
      );
      if (!ok) {
        res.status(400).json({ success: false, message: 'Current password is incorrect' });
        return;
      }
      res.json({ success: true, data: null, message: 'Password changed successfully' });
    } catch (err) {
      next(err);
    }
  }
);
