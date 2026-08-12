import { z } from 'zod';

export const customerFormSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters'),
  phone: z.string().trim(),
  email: z.string().trim(),
  notes: z.string().trim(),
});

export type CustomerFormValues = z.infer<typeof customerFormSchema>;
