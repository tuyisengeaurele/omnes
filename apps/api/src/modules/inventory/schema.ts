import { z } from 'zod';
import { MovementType } from '@prisma/client';

export const createMaterialSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  unit: z.string().min(1),
  currentStock: z.number().min(0),
  reorderLevel: z.number().min(0),
  unitCost: z.number().positive(),
  description: z.string().optional(),
});

export const updateMaterialSchema = createMaterialSchema.partial();

export const createStockMovementSchema = z.object({
  materialId: z.string().min(1),
  type: z.nativeEnum(MovementType),
  quantity: z.number().positive(),
  reference: z.string().optional(),
  notes: z.string().optional(),
});
