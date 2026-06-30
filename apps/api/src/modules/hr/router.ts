import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from '../../middleware/auth';
import { requireRole } from '../../middleware/rbac';
import { validate } from '../../middleware/validate';
import { auditLog } from '../../middleware/audit';
import { getPagination, buildPaginatedResponse } from '../../utils/pagination';
import { prisma } from '../../config/prisma';
import ExcelJS from 'exceljs';
import {
  createDepartmentSchema,
  updateDepartmentSchema,
  createEmployeeSchema,
  updateEmployeeSchema,
  updateEmployeeStatusSchema,
  createAttendanceSchema,
  updateAttendanceSchema,
  createLeaveSchema,
  updateLeaveStatusSchema,
  createPayrollRunSchema,
} from './schema';
import { exportLimiter } from '../../middleware/rateLimiter';

function computePAYE(gross: number): number {
  if (gross <= 60000) return 0;
  if (gross <= 100000) return Math.round((gross - 60000) * 0.2);
  return Math.round(8000 + (gross - 100000) * 0.3);
}

export const router = Router();
router.use(authenticate);

// ─── DEPARTMENTS ──────────────────────────────────────────────

router.get('/departments', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { page, pageSize, skip } = getPagination(req);
    const search = req.query['search'] as string | undefined;
    const where = search ? { name: { contains: search, mode: 'insensitive' as const } } : {};
    const [data, total] = await Promise.all([
      prisma.department.findMany({ where, skip, take: pageSize, orderBy: { name: 'asc' }, include: { _count: { select: { employees: true } } } }),
      prisma.department.count({ where }),
    ]);
    res.json(buildPaginatedResponse(data, total, page, pageSize));
  } catch (err) { next(err); }
});

router.post('/departments', requireRole('ADMIN', 'MANAGER', 'HR_OFFICER'), validate(createDepartmentSchema), auditLog('CREATE', 'Department'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const dept = await prisma.department.create({ data: req.body as { name: string; description?: string } });
      res.status(201).json({ success: true, data: dept });
    } catch (err) { next(err); }
  }
);

router.put('/departments/:id', requireRole('ADMIN', 'MANAGER', 'HR_OFFICER'), validate(updateDepartmentSchema), auditLog('UPDATE', 'Department'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const dept = await prisma.department.update({ where: { id: req.params['id'] }, data: req.body as Record<string, unknown> });
      res.json({ success: true, data: dept });
    } catch (err) { next(err); }
  }
);

router.delete('/departments/:id', requireRole('ADMIN'), auditLog('DELETE', 'Department'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await prisma.department.delete({ where: { id: req.params['id'] } });
      res.json({ success: true, data: null });
    } catch (err) { next(err); }
  }
);

// ─── EMPLOYEES ────────────────────────────────────────────────

const EMPLOYEE_INCLUDE = { department: { select: { id: true, name: true } } };

router.get('/employees', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { page, pageSize, skip } = getPagination(req);
    const search = req.query['search'] as string | undefined;
    const departmentId = req.query['departmentId'] as string | undefined;
    const status = req.query['status'] as string | undefined;
    const where: Record<string, unknown> = {};
    if (search) {
      where['OR'] = [
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { employeeNumber: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (departmentId) where['departmentId'] = departmentId;
    if (status) where['status'] = status;
    const [data, total] = await Promise.all([
      prisma.employee.findMany({ where, skip, take: pageSize, orderBy: { lastName: 'asc' }, include: EMPLOYEE_INCLUDE }),
      prisma.employee.count({ where }),
    ]);
    res.json(buildPaginatedResponse(data, total, page, pageSize));
  } catch (err) { next(err); }
});

router.post('/employees', requireRole('ADMIN', 'MANAGER', 'HR_OFFICER'), validate(createEmployeeSchema), auditLog('CREATE', 'Employee'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const employee = await prisma.employee.create({
        data: req.body as Record<string, unknown>,
        include: EMPLOYEE_INCLUDE,
      });
      res.status(201).json({ success: true, data: employee });
    } catch (err) { next(err); }
  }
);

router.get('/employees/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const employee = await prisma.employee.findUnique({
      where: { id: req.params['id'] },
      include: {
        department: true,
        attendances: { orderBy: { date: 'desc' }, take: 30 },
        leaveRequests: { orderBy: { createdAt: 'desc' }, take: 10 },
        payrollEntries: { orderBy: { year: 'desc' }, take: 12, include: { payrollRun: true } },
      },
    });
    if (!employee) { res.status(404).json({ success: false, message: 'Employee not found' }); return; }
    res.json({ success: true, data: employee });
  } catch (err) { next(err); }
});

router.put('/employees/:id', requireRole('ADMIN', 'MANAGER', 'HR_OFFICER'), validate(updateEmployeeSchema), auditLog('UPDATE', 'Employee'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const employee = await prisma.employee.update({
        where: { id: req.params['id'] },
        data: req.body as Record<string, unknown>,
        include: EMPLOYEE_INCLUDE,
      });
      res.json({ success: true, data: employee });
    } catch (err) { next(err); }
  }
);

router.patch('/employees/:id/status', requireRole('ADMIN', 'MANAGER', 'HR_OFFICER'), validate(updateEmployeeStatusSchema), auditLog('UPDATE_STATUS', 'Employee'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const employee = await prisma.employee.update({
        where: { id: req.params['id'] },
        data: { status: req.body.status as string },
        include: EMPLOYEE_INCLUDE,
      });
      res.json({ success: true, data: employee });
    } catch (err) { next(err); }
  }
);

router.delete('/employees/:id', requireRole('ADMIN'), auditLog('DELETE', 'Employee'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await prisma.employee.delete({ where: { id: req.params['id'] } });
      res.json({ success: true, data: null });
    } catch (err) { next(err); }
  }
);

// ─── ATTENDANCE ───────────────────────────────────────────────

router.get('/attendance', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { page, pageSize, skip } = getPagination(req);
    const employeeId = req.query['employeeId'] as string | undefined;
    const month = req.query['month'] ? parseInt(req.query['month'] as string, 10) : undefined;
    const year = req.query['year'] ? parseInt(req.query['year'] as string, 10) : undefined;
    const where: Record<string, unknown> = {};
    if (employeeId) where['employeeId'] = employeeId;
    if (month && year) {
      const start = new Date(year, month - 1, 1);
      const end = new Date(year, month, 0, 23, 59, 59);
      where['date'] = { gte: start, lte: end };
    }
    const [data, total] = await Promise.all([
      prisma.attendance.findMany({ where, skip, take: pageSize, orderBy: { date: 'desc' }, include: { employee: { select: { id: true, firstName: true, lastName: true, employeeNumber: true } } } }),
      prisma.attendance.count({ where }),
    ]);
    res.json(buildPaginatedResponse(data, total, page, pageSize));
  } catch (err) { next(err); }
});

router.post('/attendance', requireRole('ADMIN', 'MANAGER', 'HR_OFFICER'), validate(createAttendanceSchema), auditLog('CREATE', 'Attendance'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const att = await prisma.attendance.create({ data: req.body as Record<string, unknown>, include: { employee: { select: { firstName: true, lastName: true } } } });
      res.status(201).json({ success: true, data: att });
    } catch (err) { next(err); }
  }
);

router.put('/attendance/:id', requireRole('ADMIN', 'MANAGER', 'HR_OFFICER'), validate(updateAttendanceSchema), auditLog('UPDATE', 'Attendance'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const att = await prisma.attendance.update({ where: { id: req.params['id'] }, data: req.body as Record<string, unknown> });
      res.json({ success: true, data: att });
    } catch (err) { next(err); }
  }
);

// ─── LEAVE REQUESTS ───────────────────────────────────────────

router.get('/leaves', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { page, pageSize, skip } = getPagination(req);
    const employeeId = req.query['employeeId'] as string | undefined;
    const status = req.query['status'] as string | undefined;
    const where: Record<string, unknown> = {};
    if (employeeId) where['employeeId'] = employeeId;
    if (status) where['status'] = status;
    const [data, total] = await Promise.all([
      prisma.leaveRequest.findMany({ where, skip, take: pageSize, orderBy: { createdAt: 'desc' }, include: { employee: { select: { firstName: true, lastName: true, employeeNumber: true } } } }),
      prisma.leaveRequest.count({ where }),
    ]);
    res.json(buildPaginatedResponse(data, total, page, pageSize));
  } catch (err) { next(err); }
});

router.post('/leaves', requireRole('ADMIN', 'MANAGER', 'HR_OFFICER'), validate(createLeaveSchema), auditLog('CREATE', 'LeaveRequest'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const leave = await prisma.leaveRequest.create({ data: req.body as Record<string, unknown>, include: { employee: { select: { firstName: true, lastName: true } } } });
      res.status(201).json({ success: true, data: leave });
    } catch (err) { next(err); }
  }
);

router.put('/leaves/:id/status', requireRole('ADMIN', 'MANAGER', 'HR_OFFICER'), validate(updateLeaveStatusSchema), auditLog('UPDATE_STATUS', 'LeaveRequest'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { status, approvedBy } = req.body as { status: string; approvedBy?: string };
      const leave = await prisma.leaveRequest.update({
        where: { id: req.params['id'] },
        data: {
          status: status as 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED',
          approvedBy: approvedBy ?? req.user!.id,
          approvedAt: ['APPROVED', 'REJECTED'].includes(status) ? new Date() : undefined,
        },
      });
      res.json({ success: true, data: leave });
    } catch (err) { next(err); }
  }
);

// ─── PAYROLL ──────────────────────────────────────────────────

router.get('/payroll', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { page, pageSize, skip } = getPagination(req);
    const month = req.query['month'] ? parseInt(req.query['month'] as string, 10) : undefined;
    const year = req.query['year'] ? parseInt(req.query['year'] as string, 10) : undefined;
    const where: Record<string, unknown> = {};
    if (month) where['month'] = month;
    if (year) where['year'] = year;
    const [data, total] = await Promise.all([
      prisma.payrollRun.findMany({ where, skip, take: pageSize, orderBy: [{ year: 'desc' }, { month: 'desc' }], include: { _count: { select: { entries: true } } } }),
      prisma.payrollRun.count({ where }),
    ]);
    res.json(buildPaginatedResponse(data, total, page, pageSize));
  } catch (err) { next(err); }
});

router.post('/payroll/run', requireRole('ADMIN', 'MANAGER', 'HR_OFFICER'), validate(createPayrollRunSchema), auditLog('CREATE', 'PayrollRun'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { month, year } = req.body as { month: number; year: number };

      const existing = await prisma.payrollRun.findFirst({ where: { month, year } });
      if (existing) {
        res.status(409).json({
          success: false,
          message: `A payroll run for ${month}/${year} already exists (status: ${existing.status}).`,
        });
        return;
      }

      const employees = await prisma.employee.findMany({ where: { status: 'ACTIVE' } });
      let totalAmount = 0;
      const entries = employees.map((emp) => {
        const gross = Number(emp.salary);
        const paye = computePAYE(gross);
        const net = gross - paye;
        totalAmount += net;
        return { employeeId: emp.id, month, year, grossSalary: gross, netSalary: net };
      });

      const run = await prisma.payrollRun.create({
        data: {
          month,
          year,
          totalAmount,
          status: 'DRAFT',
          entries: { create: entries },
        },
        include: { entries: { include: { employee: { select: { firstName: true, lastName: true, bankName: true, bankAccountNumber: true } } } } },
      });
      res.status(201).json({ success: true, data: run });
    } catch (err) { next(err); }
  }
);

router.get('/payroll/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const run = await prisma.payrollRun.findUnique({
      where: { id: req.params['id'] },
      include: { entries: { include: { employee: { select: { firstName: true, lastName: true, employeeNumber: true, bankName: true, bankAccountNumber: true, position: true } } } } },
    });
    if (!run) { res.status(404).json({ success: false, message: 'Payroll run not found' }); return; }
    res.json({ success: true, data: run });
  } catch (err) { next(err); }
});

router.put('/payroll/:id/mark-paid', requireRole('ADMIN', 'ACCOUNTANT'), auditLog('MARK_PAID', 'PayrollRun'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const [run] = await Promise.all([
        prisma.payrollRun.update({ where: { id: req.params['id'] }, data: { status: 'PAID' } }),
        prisma.payrollEntry.updateMany({ where: { payrollRunId: req.params['id'] }, data: { paid: true, paidAt: new Date() } }),
      ]);
      res.json({ success: true, data: run });
    } catch (err) { next(err); }
  }
);

router.get('/payroll/export/bulk-payment', exportLimiter, requireRole('ADMIN', 'ACCOUNTANT', 'MANAGER'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const runId = req.query['runId'] as string;
      if (!runId) { res.status(400).json({ success: false, message: 'runId required' }); return; }

      const run = await prisma.payrollRun.findUnique({
        where: { id: runId },
        include: { entries: { include: { employee: true } } },
      });
      if (!run) { res.status(404).json({ success: false, message: 'Payroll run not found' }); return; }

      const company = await prisma.companySettings.findUnique({ where: { id: 'default' } });
      const monthName = new Date(run.year, run.month - 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });

      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Bulk Payment');

      sheet.mergeCells('A1:H1');
      sheet.getCell('A1').value = `BULK PAYMENT - ${company?.name ?? 'OMNES Manufacturing Ltd'} - ${monthName}`;
      sheet.getCell('A1').font = { bold: true, size: 12 };

      const headers = ['RESERVED', 'BENEFICIARY NAME', 'BANK NAME', 'BENEFICIARY ACCOUNT NUMBER', 'CREDIT AMOUNT RWF', 'NARRATION', 'RECONCILIATION ACC', 'RESERVED'];
      sheet.addRow(headers).font = { bold: true };

      run.entries.forEach((entry) => {
        sheet.addRow([
          '',
          `${entry.employee.firstName} ${entry.employee.lastName}`,
          entry.employee.bankName,
          entry.employee.bankAccountNumber,
          Number(entry.netSalary),
          `Salary ${monthName}`,
          '000490774630268',
          '',
        ]);
      });

      const totalRow = sheet.addRow(['', '', '', 'TOTAL', Number(run.totalAmount), '', '', '']);
      totalRow.font = { bold: true };
      sheet.addRow(['', '', '', '', '', '', `PREPARED AND APPROVED BY: Managing Director`, '', '']);

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="bulk-payment-${run.month}-${run.year}.xlsx"`);
      await workbook.xlsx.write(res);
      res.end();
    } catch (err) { next(err); }
  }
);
