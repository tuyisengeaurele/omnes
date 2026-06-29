import { z } from 'zod';

export const updateCompanySettingsSchema = z.object({
  name: z.string().min(1).optional(),
  tinNumber: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  address: z.string().optional(),
  website: z.string().optional(),
  currency: z.string().optional(),
  vatRate: z.coerce.number().min(0).max(100).optional(),
  financialYearStart: z.coerce.number().int().min(1).max(12).optional(),
});
