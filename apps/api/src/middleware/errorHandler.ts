import { Request, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { logger } from '../config/logger';

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const requestId = req.headers['x-request-id'] as string | undefined;
  const userId = req.user?.id;

  logger.error('Unhandled error', {
    message: err.message,
    stack: err.stack,
    requestId,
    userId,
    method: req.method,
    path: req.path,
  });

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      res.status(409).json({ success: false, message: 'A record with that value already exists.' });
      return;
    }
    if (err.code === 'P2025') {
      res.status(404).json({ success: false, message: 'Record not found.' });
      return;
    }
  }

  res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
}
