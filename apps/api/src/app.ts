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
import type { PaymentPort } from './adapters/payment/index.js';
import { mockMomoAdapter } from './adapters/payment/mockMomoAdapter.js';
import type { NotificationPort } from './adapters/notification/index.js';
import { createLoggingNotificationAdapter } from './adapters/notification/loggingAdapter.js';
import type { RealtimePort } from './adapters/realtime/index.js';
import { createInMemoryRealtimeAdapter } from './adapters/realtime/inMemoryRealtimeAdapter.js';
import {
  createAuthService,
  createIdentityRouter,
  createDriverRouter,
  createOtpService,
  createTokenService,
  prismaOtpStore,
  prismaRefreshTokenStore,
} from './modules/identity/index.js';
import {
  createCatalogRouter,
  createCatalogService,
  findMerchantById,
  findProductById,
} from './modules/catalog/index.js';
import {
  createCartRouter,
  createCartService,
  createCheckoutRouter,
  createCheckoutService,
  createOrderLifecycleRouter,
  createOrderLifecycleService,
  findOrderPickupInfo,
} from './modules/order/index.js';
import { createPaymentWebhookRouter, createWebhookProcessor } from './modules/payment/index.js';
import {
  createDispatchRouter,
  createDispatchService,
  nearestAvailableStrategy,
  findCandidateLocationsInBox,
  createOffer as createDispatchOffer,
  findOfferById,
  findOpenOfferForOrder,
  findTriedDriverIds,
  resolveOffer,
  createAssignment,
  findAssignmentById,
  completeAssignment,
  logDispatchDecision,
} from './modules/dispatch/index.js';

export interface AppDeps {
  config: Config;
  logger: Logger;
  /** Defaults to the mock adapter. Tests substitute a spy to capture sent codes. */
  smsPort?: SmsPort;
  /** Defaults to the mock adapter. Tests substitute a spy to force specific outcomes. */
  paymentPort?: PaymentPort;
  /** Defaults to the logging adapter. Tests substitute a spy to capture what was sent. */
  notificationPort?: NotificationPort;
  /** Defaults to the in-memory adapter. Tests substitute a spy to capture published events. */
  realtimePort?: RealtimePort;
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
  const cartService = createCartService({ findProductById, findMerchantById });
  const checkoutService = createCheckoutService({
    catalog: { findMerchantById },
    cart: cartService,
    geo: haversineGeoAdapter,
    payment: deps.paymentPort ?? mockMomoAdapter,
  });

  const realtimePort = deps.realtimePort ?? createInMemoryRealtimeAdapter();
  const lifecycleService = createOrderLifecycleService({
    realtime: realtimePort,
    notification: deps.notificationPort ?? createLoggingNotificationAdapter(deps.logger),
  });
  const webhookProcessor = createWebhookProcessor({ lifecycle: lifecycleService });

  const dispatchService = createDispatchService({
    geo: haversineGeoAdapter,
    strategy: nearestAvailableStrategy,
    lifecycle: lifecycleService,
    offerTimeoutSeconds: deps.config.DISPATCH_OFFER_TIMEOUT_SECONDS,
    initialRadiusMeters: deps.config.DISPATCH_INITIAL_RADIUS_METERS,
    escalatedRadiusMeters: deps.config.DISPATCH_ESCALATED_RADIUS_METERS,
    findOrderInfo: findOrderPickupInfo,
    findCandidates: findCandidateLocationsInBox,
    createOffer: createDispatchOffer,
    findOfferById,
    findOpenOfferForOrder,
    findTriedDriverIds,
    resolveOffer,
    createAssignment,
    findAssignmentById,
    completeAssignment,
    logDecision: logDispatchDecision,
  });

  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  app.use('/api/auth', createIdentityRouter(authService, tokenService, deps.config));
  app.use('/api/drivers', createDriverRouter(tokenService));
  app.use('/api/catalog', createCatalogRouter(catalogService, tokenService));
  app.use('/api/cart', createCartRouter(cartService, tokenService));
  app.use('/api/checkout', createCheckoutRouter(checkoutService, tokenService));
  app.use(
    '/api/orders',
    createOrderLifecycleRouter(lifecycleService, realtimePort, tokenService, (orderId) =>
      dispatchService.advanceDispatch(orderId).then(() => undefined)
    )
  );
  app.use('/api/dispatch', createDispatchRouter(dispatchService, tokenService));
  app.use(
    '/api/payments/webhooks',
    createPaymentWebhookRouter(webhookProcessor, deps.config.PAYMENT_WEBHOOK_SECRET)
  );

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
