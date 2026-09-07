/**
 * Builds the Express app without binding a port. Kept separate from
 * server.ts so integration tests can exercise the real app via supertest -
 * including real middleware, real routing, real error handling - without
 * an actual listening socket, and can substitute a fake SmsPort to capture
 * the OTP code a test needs to complete a flow, the way a human tester
 * would read it off their phone.
 */

import express, { type Express } from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import type { Logger } from 'pino';
import type { Config } from './platform/config.js';
import { corsMiddleware } from './platform/cors.js';
import { generalRateLimiter } from './platform/rateLimit.js';
import { errorHandler, notFoundHandler } from './platform/errorHandler.js';
import type { SmsPort } from './adapters/sms/index.js';
import { mockSmsAdapter } from './adapters/sms/mockAdapter.js';
import { haversineGeoAdapter } from './adapters/geo/haversineAdapter.js';
import {
  createAuthService,
  createIdentityRouter,
  createOtpService,
  createTokenService,
  prismaOtpStore,
  prismaRefreshTokenStore,
} from './modules/identity/index.js';
import { createCatalogRouter, createCatalogService } from './modules/catalog/index.js';

export interface AppDeps {
  config: Config;
  logger: Logger;
  /** Defaults to the mock adapter. Tests substitute a spy to capture sent codes. */
  smsPort?: SmsPort;
}

export function createApp(deps: AppDeps): Express {
  const app = express();

  app.use(helmet());
  app.use(corsMiddleware(deps.config));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.use(pinoHttp({ logger: deps.logger }));
  app.use(generalRateLimiter(deps.config));

  const otpService = createOtpService({
    store: prismaOtpStore,
    pepper: deps.config.OTP_PEPPER,
    ttlSeconds: deps.config.OTP_TTL_SECONDS,
    codeLength: deps.config.OTP_LENGTH,
    maxAttempts: deps.config.OTP_MAX_ATTEMPTS,
    requestsPerHour: deps.config.OTP_REQUESTS_PER_HOUR,
  });

  const tokenService = createTokenService({
    refreshStore: prismaRefreshTokenStore,
    accessSecret: deps.config.JWT_ACCESS_SECRET,
    accessTtlSeconds: deps.config.JWT_ACCESS_TTL_SECONDS,
    refreshTtlDays: deps.config.REFRESH_TOKEN_TTL_DAYS,
  });

  const authService = createAuthService({
    otpService,
    tokenService,
    smsPort: deps.smsPort ?? mockSmsAdapter,
  });

  const catalogService = createCatalogService(haversineGeoAdapter);

  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  app.use('/api/auth', createIdentityRouter(authService, tokenService, deps.config));
  app.use('/api/catalog', createCatalogRouter(catalogService, tokenService));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
