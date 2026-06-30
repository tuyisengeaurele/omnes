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
import { logger } from '../../config/logger';

export const router = Router();

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env['NODE_ENV'] === 'production',
  sameSite: 'strict' as const,
  maxAge: 7 * 24 * 60 * 60 * 1000,
  path: '/',
};

router.post(
  '/login',
  authLimiter,
  validate(loginSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await loginUser(req.body.email, req.body.password);
      if (!result) {
        logger.warn('Failed login attempt', {
          email: req.body.email as string,
          ip: req.ip,
          userAgent: req.headers['user-agent'],
        });
        res.status(401).json({ success: false, message: 'Invalid email or password' });
        return;
      }
      res.cookie('omnes_refresh', result.refreshToken, COOKIE_OPTIONS);
      res.json({ success: true, data: { accessToken: result.accessToken, user: result.user } });
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
      const token =
        (req.cookies as Record<string, string>)['omnes_refresh'] ??
        (req.body?.refreshToken as string | undefined);
      if (!token) {
        res.status(401).json({ success: false, message: 'No refresh token' });
        return;
      }
      const result = await rotateRefreshToken(token);
      if (!result) {
        res.clearCookie('omnes_refresh', { path: '/' });
        res.status(401).json({ success: false, message: 'Session expired. Please log in again.' });
        return;
      }
      res.cookie('omnes_refresh', result.refreshToken, COOKIE_OPTIONS);
      res.json({ success: true, data: { accessToken: result.accessToken } });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/logout',
  authenticate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const token =
        (req.cookies as Record<string, string>)['omnes_refresh'] ??
        (req.body as { refreshToken?: string }).refreshToken;
      if (token) await burnRefreshToken(token);
      res.clearCookie('omnes_refresh', { path: '/' });
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
