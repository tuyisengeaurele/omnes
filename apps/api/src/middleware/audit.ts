import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/prisma';
import { logger } from '../config/logger';

export function auditLog(action: string, entity: string) {
  return (_req: Request, res: Response, next: NextFunction): void => {
    const originalJson = res.json.bind(res);

    res.json = function (body: unknown) {
      const req = _req;
      if (req.user && res.statusCode >= 200 && res.statusCode < 300) {
        const responseBody = body as Record<string, unknown>;
        const entityId =
          (responseBody?.data as Record<string, unknown>)?.id as string | undefined;

        prisma.auditLog
          .create({
            data: {
              userId: req.user.id,
              action,
              entity,
              entityId: entityId ?? null,
              newValues: req.method !== 'DELETE' ? (req.body as Record<string, unknown>) : null,
              ipAddress: req.ip ?? null,
              userAgent: req.headers['user-agent'] ?? null,
            },
          })
          .catch((err: unknown) => {
            logger.error('Failed to write audit log', { err });
          });
      }
      return originalJson(body);
    };

    next();
  };
}
