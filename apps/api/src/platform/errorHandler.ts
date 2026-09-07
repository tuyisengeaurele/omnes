/**
 * The single place an error becomes an HTTP response. Express 5 forwards a
 * rejected promise from an async route handler here automatically, so
 * route handlers do not need a try/catch or an asyncHandler wrapper - they
 * just throw or reject, and it lands here.
 */

import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { HttpError } from './errors.js';
import { getLogger } from './logger.js';

interface ErrorResponseBody {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

function send(res: Response, status: number, code: string, message: string, details?: Record<string, unknown>): void {
  const body: ErrorResponseBody = { error: { code, message } };
  if (details !== undefined) body.error.details = details;
  res.status(status).json(body);
}

// Express recognizes an error-handling middleware by its exact arity: this
// must take four parameters, including the unused one, or Express treats it
// as a normal middleware and never calls it on an error.
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  const logger = getLogger();

  if (err instanceof HttpError) {
    // 4xx is an expected outcome of normal traffic (a bad password, a stale
    // token) and logs at info; 5xx and anything unclassified is a bug and
    // logs at error so it pages someone.
    const level = err.status >= 500 ? 'error' : 'info';
    logger[level]({ err, path: req.path, method: req.method, status: err.status }, err.message);
    send(res, err.status, err.code, err.message, err.details);
    return;
  }

  if (err instanceof ZodError) {
    logger.info({ issues: err.issues, path: req.path, method: req.method }, 'request validation failed');
    send(res, 400, 'VALIDATION_FAILED', 'The request did not match the expected shape.', {
      issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
    return;
  }

  logger.error({ err, path: req.path, method: req.method }, 'unhandled error');
  send(res, 500, 'INTERNAL_ERROR', 'Something went wrong. Please try again.');
}

export function notFoundHandler(req: Request, res: Response): void {
  send(res, 404, 'NOT_FOUND', `No route matches ${req.method} ${req.path}.`);
}
