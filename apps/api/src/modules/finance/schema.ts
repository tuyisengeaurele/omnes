import { z } from 'zod';
import { AccountType } from '@prisma/client';

export const createAccountSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  type: z.nativeEnum(AccountType),
  description: z.string().optional(),
  parentId: z.string().optional(),
});

export const updateAccountSchema = createAccountSchema.partial();

export const journalLineSchema = z.object({
  accountId: z.string().min(1),
  debit: z.number().min(0).default(0),
  credit: z.number().min(0).default(0),
  description: z.string().optional(),
});

export const createJournalEntrySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().min(1),
  totalDebit: z.number().min(0),
  totalCredit: z.number().min(0),
  lines: z.array(journalLineSchema).min(2),
});

export const createExpenseSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  category: z.string().min(1),
  description: z.string().min(1),
  amount: z.number().positive(),
  paidBy: z.string().min(1),
  receipt: z.string().optional(),
  notes: z.string().optional(),
});

export const updateExpenseSchema = createExpenseSchema.partial();
