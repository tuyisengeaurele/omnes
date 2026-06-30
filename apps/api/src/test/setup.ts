import { vi } from 'vitest';

// Mock env config to avoid requiring real env vars at module load time
vi.mock('../config/env', () => ({
  env: {
    port: 3001,
    nodeEnv: 'test',
    databaseUrl: 'postgresql://test:test@localhost/test',
    jwt: {
      accessSecret: 'test_access_secret_for_tests_only',
      refreshSecret: 'test_refresh_secret_for_tests_only',
      accessExpiresIn: '15m',
      refreshExpiresIn: '7d',
    },
    corsOrigin: 'http://localhost:5173',
    logoPath: '',
  },
}));

vi.mock('../config/prisma', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
    refreshToken: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    sale: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      aggregate: vi.fn(),
    },
    productType: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
    companySettings: {
      findUnique: vi.fn(),
    },
    payrollRun: {
      findFirst: vi.fn(),
      create: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
    employee: {
      findMany: vi.fn(),
    },
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
  },
}));
