import { z } from 'zod';

export const addUserFormSchema = z.object({
  username: z.string().trim().min(3, 'Username must be at least 3 characters'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  role: z.enum(['ADMIN', 'MANAGER', 'CASHIER']),
});

export type AddUserFormValues = z.infer<typeof addUserFormSchema>;
