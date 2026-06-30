import { z } from 'zod';
import { BatchStatus } from '@prisma/client';

export const createProductTypeSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  unitPrice: z.number().positive(),
  unit: z.string().min(1).default('piece'),
});

export const updateProductTypeSchema = createProductTypeSchema.partial();

export const createKilnSchema = z.object({
  name: z.string().min(1),
  location: z.string().min(1),
  capacity: z.number().int().positive(),
});

export const updateKilnSchema = createKilnSchema.partial();

export const createBatchSchema = z.object({
  batchNumber: z.string().min(1),
  kilnId: z.string().min(1),
  plannedStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().optional(),
});

export const updateBatchSchema = createBatchSchema.partial().extend({
  actualStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  firingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  completionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const updateBatchStatusSchema = z.object({
  status: z.nativeEnum(BatchStatus),
});

export const createBatchOutputSchema = z.object({
  productId: z.string().min(1),
  planned: z.number().int().positive(),
  produced: z.number().int().nonnegative(),
  rejected: z.number().int().nonnegative(),
}).refine(data => data.rejected <= data.produced, {
  message: 'Rejected quantity cannot exceed produced quantity',
  path: ['rejected'],
});

export const createMaterialUsageSchema = z.object({
  materialId: z.string().min(1),
  quantity: z.number().positive(),
});
