import { z } from 'zod';
import { DepreciationMethod, MaintenanceStatus } from '@prisma/client';

export const createAssetSchema = z.object({
  assetNumber: z.string().min(1),
  name: z.string().min(1),
  category: z.string().min(1),
  description: z.string().optional(),
  purchaseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  purchaseCost: z.number().positive(),
  salvageValue: z.number().min(0),
  usefulLifeYears: z.number().int().positive(),
  depreciationMethod: z.nativeEnum(DepreciationMethod).default('STRAIGHT_LINE'),
  currentValue: z.number().min(0),
  location: z.string().min(1),
});

export const updateAssetSchema = createAssetSchema.partial();

export const createMaintenanceLogSchema = z.object({
  assetId: z.string().optional(),
  kilnId: z.string().optional(),
  title: z.string().min(1),
  description: z.string().min(1),
  scheduledAt: z.string().datetime({ offset: true }).or(z.string()),
  cost: z.number().min(0).optional(),
  technician: z.string().optional(),
  notes: z.string().optional(),
});

export const updateMaintenanceLogSchema = createMaintenanceLogSchema.partial().extend({
  completedAt: z.string().optional(),
});

export const updateMaintenanceStatusSchema = z.object({
  status: z.nativeEnum(MaintenanceStatus),
  completedAt: z.string().optional(),
  cost: z.number().min(0).optional(),
});
