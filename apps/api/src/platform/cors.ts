/**
 * CORS locked to a known origin allowlist, never a wildcard - including in
 * local development, per the security checklist. `credentials: true` is
 * required because auth relies on cookies rather than an Authorization
 * header, and a wildcard origin is incompatible with credentialed requests
 * anyway (the browser refuses it), so there is no accidental way to loosen
 * this without it breaking obviously.
 */

import cors, { type CorsOptions } from 'cors';
import type { Config } from './config.js';

export function buildCorsOptions(config: Config): CorsOptions {
  const allowed = new Set(config.CORS_ALLOWED_ORIGINS);

  return {
    credentials: true,
    origin(origin, callback) {
      // No Origin header at all means a same-origin request, a server-to-
      // server call, or a tool like curl - not a browser cross-origin
      // request, so there is nothing for CORS to police here.
      if (!origin || allowed.has(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error(`Origin ${origin} is not allowed`));
    },
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'X-CSRF-Token'],
  };
}

export function corsMiddleware(config: Config) {
  return cors(buildCorsOptions(config));
}
