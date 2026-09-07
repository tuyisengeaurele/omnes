/**
 * The one error type route handlers throw for an expected failure (bad
 * input, no session, wrong role, rate limited). errorHandler.ts is the only
 * place that turns this into an HTTP response, so the response shape is
 * defined once, matching packages/contracts' apiErrorSchema.
 *
 * Anything that is not an HttpError is treated as a bug: logged with full
 * detail server-side and returned to the client as a generic 500 with no
 * internal detail, since a stack trace or a query string in a response body
 * is exactly the kind of thing the security checklist rules out.
 */

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

export function badRequest(
  code: string,
  message: string,
  details?: Record<string, unknown>
): HttpError {
  return new HttpError(400, code, message, details);
}

export function unauthorized(code: string, message: string): HttpError {
  return new HttpError(401, code, message);
}

export function forbidden(code: string, message: string): HttpError {
  return new HttpError(403, code, message);
}

export function notFound(code: string, message: string): HttpError {
  return new HttpError(404, code, message);
}

export function conflict(code: string, message: string): HttpError {
  return new HttpError(409, code, message);
}

export function tooManyRequests(
  code: string,
  message: string,
  retryAfterSeconds?: number
): HttpError {
  return retryAfterSeconds === undefined
    ? new HttpError(429, code, message)
    : new HttpError(429, code, message, { retryAfterSeconds });
}
