import { Request, Response, NextFunction } from 'express';
import { UserRole } from '@prisma/client';

export function requireRole(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Login required' });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ success: false, message: 'Access denied' });
      return;
    }
    next();
  };
}
