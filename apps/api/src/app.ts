import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import { env } from './config/env';
import { logger } from './config/logger';
import { generalLimiter } from './middleware/rateLimiter';
import { errorHandler } from './middleware/errorHandler';

const app = express();

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameSrc: ["'none'"],
        baseUri: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);
app.use(cookieParser());
app.use(
  cors({
    origin: env.corsOrigin,
    credentials: true,
  })
);
app.use(morgan('combined', { stream: { write: (msg) => logger.info(msg.trim()) } }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(generalLimiter);

// Routes will be mounted here
import { router as publicRouter } from './modules/public/router';
import { router as authRouter } from './modules/auth/router';
import { router as usersRouter } from './modules/users/router';
import { router as hrRouter } from './modules/hr/router';
import { router as productionRouter } from './modules/production/router';
import { router as inventoryRouter } from './modules/inventory/router';
import { router as procurementRouter } from './modules/procurement/router';
import { router as salesRouter } from './modules/sales/router';
import { router as financeRouter } from './modules/finance/router';
import { router as assetsRouter } from './modules/assets/router';
import { router as reportsRouter } from './modules/reports/router';
import { router as settingsRouter } from './modules/settings/router';

app.use('/api', publicRouter);
app.use('/api/auth', authRouter);
app.use('/api/users', usersRouter);
app.use('/api', hrRouter);
app.use('/api', productionRouter);
app.use('/api', inventoryRouter);
app.use('/api', procurementRouter);
app.use('/api', salesRouter);
app.use('/api', financeRouter);
app.use('/api', assetsRouter);
app.use('/api', reportsRouter);
app.use('/api', settingsRouter);

app.get('/api/health', async (_req, res) => {
  try {
    const { prisma } = await import('./config/prisma');
    await prisma.$queryRaw`SELECT 1`;
    res.json({ success: true, data: { status: 'ok', db: 'connected', timestamp: new Date().toISOString() } });
  } catch {
    res.status(503).json({ success: false, data: { status: 'degraded', db: 'disconnected', timestamp: new Date().toISOString() } });
  }
});

app.use(errorHandler);

app.listen(env.port, () => {
  logger.info(`OMNES API running on port ${env.port} [${env.nodeEnv}]`);
});

export default app;
