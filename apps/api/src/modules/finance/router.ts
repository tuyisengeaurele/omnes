import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from '../../middleware/auth';
import { requireRole } from '../../middleware/rbac';
import { validate } from '../../middleware/validate';
import { auditLog } from '../../middleware/audit';
import { getPagination, buildPaginatedResponse } from '../../utils/pagination';
import { prisma } from '../../config/prisma';
import { createAccountSchema, updateAccountSchema, createJournalEntrySchema, createExpenseSchema, updateExpenseSchema } from './schema';

export const router = Router();
router.use(authenticate);

// ─── CHART OF ACCOUNTS ────────────────────────────────────────

router.get('/accounts', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { page, pageSize, skip } = getPagination(req);
    const type = req.query['type'] as string | undefined;
    const where = type ? { type: type as 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE' } : {};
    const [data, total] = await Promise.all([
      prisma.account.findMany({ where, skip, take: pageSize, orderBy: { code: 'asc' }, include: { parent: { select: { id: true, name: true, code: true } }, _count: { select: { children: true } } } }),
      prisma.account.count({ where }),
    ]);
    res.json(buildPaginatedResponse(data, total, page, pageSize));
  } catch (err) { next(err); }
});

router.post('/accounts', requireRole('ADMIN', 'ACCOUNTANT'), validate(createAccountSchema), auditLog('CREATE', 'Account'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const account = await prisma.account.create({ data: req.body as Record<string, unknown> });
      res.status(201).json({ success: true, data: account });
    } catch (err) { next(err); }
  }
);

router.put('/accounts/:id', requireRole('ADMIN', 'ACCOUNTANT'), validate(updateAccountSchema), auditLog('UPDATE', 'Account'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const account = await prisma.account.update({ where: { id: req.params['id'] }, data: req.body as Record<string, unknown> });
      res.json({ success: true, data: account });
    } catch (err) { next(err); }
  }
);

// ─── JOURNAL ENTRIES ──────────────────────────────────────────

router.get('/journal-entries', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { page, pageSize, skip } = getPagination(req);
    const [data, total] = await Promise.all([
      prisma.journalEntry.findMany({ skip, take: pageSize, orderBy: { date: 'desc' }, include: { _count: { select: { lines: true } } } }),
      prisma.journalEntry.count(),
    ]);
    res.json(buildPaginatedResponse(data, total, page, pageSize));
  } catch (err) { next(err); }
});

router.post('/journal-entries', requireRole('ADMIN', 'ACCOUNTANT'), validate(createJournalEntrySchema), auditLog('CREATE', 'JournalEntry'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { lines, ...entryData } = req.body as { lines: Array<{ accountId: string; debit: number; credit: number; description?: string }>; date: string; description: string; totalDebit: number; totalCredit: number };
      const reference = `JE-${Date.now()}`;
      const entry = await prisma.journalEntry.create({
        data: { ...entryData, reference, lines: { create: lines } },
        include: { lines: { include: { account: { select: { name: true, code: true } } } } },
      });
      res.status(201).json({ success: true, data: entry });
    } catch (err) { next(err); }
  }
);

router.get('/journal-entries/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const entry = await prisma.journalEntry.findUnique({
      where: { id: req.params['id'] },
      include: { lines: { include: { account: { select: { id: true, name: true, code: true, type: true } } } } },
    });
    if (!entry) { res.status(404).json({ success: false, message: 'Journal entry not found' }); return; }
    res.json({ success: true, data: entry });
  } catch (err) { next(err); }
});

// ─── EXPENSES ─────────────────────────────────────────────────

router.get('/expenses', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { page, pageSize, skip } = getPagination(req);
    const category = req.query['category'] as string | undefined;
    const where = category ? { category } : {};
    const [data, total] = await Promise.all([
      prisma.expense.findMany({ where, skip, take: pageSize, orderBy: { date: 'desc' } }),
      prisma.expense.count({ where }),
    ]);
    res.json(buildPaginatedResponse(data, total, page, pageSize));
  } catch (err) { next(err); }
});

router.post('/expenses', requireRole('ADMIN', 'ACCOUNTANT', 'MANAGER'), validate(createExpenseSchema), auditLog('CREATE', 'Expense'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const reference = `EXP-${Date.now()}`;
      const expense = await prisma.expense.create({ data: { ...(req.body as Record<string, unknown>), reference } });
      res.status(201).json({ success: true, data: expense });
    } catch (err) { next(err); }
  }
);

router.put('/expenses/:id', requireRole('ADMIN', 'ACCOUNTANT'), validate(updateExpenseSchema), auditLog('UPDATE', 'Expense'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const expense = await prisma.expense.update({ where: { id: req.params['id'] }, data: req.body as Record<string, unknown> });
      res.json({ success: true, data: expense });
    } catch (err) { next(err); }
  }
);

router.delete('/expenses/:id', requireRole('ADMIN', 'ACCOUNTANT'), auditLog('DELETE', 'Expense'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await prisma.expense.delete({ where: { id: req.params['id'] } });
      res.json({ success: true, data: null });
    } catch (err) { next(err); }
  }
);
