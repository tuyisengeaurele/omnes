import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from '../../middleware/auth';
import { exportLimiter, reportDataLimiter } from '../../middleware/rateLimiter';
import { prisma } from '../../config/prisma';
import ExcelJS from 'exceljs';

export const router = Router();
router.use(authenticate);

// ─── DASHBOARD KPIs ───────────────────────────────────────────

router.get('/reports/dashboard', reportDataLimiter, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);

    const [
      currentMonthSales,
      lastMonthSales,
      activeEmployees,
      pendingOrders,
      lowStockCount,
      batchesThisMonth,
      recentAuditLogs,
    ] = await Promise.all([
      prisma.sale.aggregate({ where: { saleDate: { gte: startOfMonth }, status: { not: 'CANCELLED' } }, _sum: { totalAmount: true } }),
      prisma.sale.aggregate({ where: { saleDate: { gte: startOfLastMonth, lte: endOfLastMonth }, status: { not: 'CANCELLED' } }, _sum: { totalAmount: true } }),
      prisma.employee.count({ where: { status: 'ACTIVE' } }),
      prisma.sale.count({ where: { status: { in: ['PROFORMA', 'CONFIRMED'] } } }),
      prisma.$queryRaw<[{ count: bigint }]>`SELECT COUNT(*) as count FROM "RawMaterial" WHERE "currentStock" <= "reorderLevel"`,
      prisma.productionBatch.count({ where: { createdAt: { gte: startOfMonth } } }),
      prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 10, include: { user: { select: { firstName: true, lastName: true } } } }),
    ]);

    const currentRevenue = Number(currentMonthSales._sum.totalAmount ?? 0);
    const lastRevenue = Number(lastMonthSales._sum.totalAmount ?? 0);
    const revenueTrend = lastRevenue > 0 ? ((currentRevenue - lastRevenue) / lastRevenue) * 100 : 0;

    const outstandingReceivables = await prisma.sale.aggregate({
      where: { paymentStatus: { in: ['UNPAID', 'PARTIAL'] }, status: { not: 'CANCELLED' } },
      _sum: { totalAmount: true, amountPaid: true },
    });
    const outstanding = Number(outstandingReceivables._sum.totalAmount ?? 0) - Number(outstandingReceivables._sum.amountPaid ?? 0);

    const last6Months = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
      return { year: d.getFullYear(), month: d.getMonth() + 1 };
    });

    const monthlyProduction = await Promise.all(
      last6Months.map(async ({ year, month }) => {
        const start = new Date(year, month - 1, 1);
        const end = new Date(year, month, 0, 23, 59, 59);
        const total = await prisma.batchOutput.aggregate({
          where: { batch: { completionDate: { gte: start, lte: end } } },
          _sum: { produced: true },
        });
        return { year, month, produced: Number(total._sum.produced ?? 0) };
      })
    );

    const monthlyRevenue = await Promise.all(
      last6Months.map(async ({ year, month }) => {
        const start = new Date(year, month - 1, 1);
        const end = new Date(year, month, 0, 23, 59, 59);
        const total = await prisma.sale.aggregate({
          where: { saleDate: { gte: start, lte: end }, status: { not: 'CANCELLED' } },
          _sum: { totalAmount: true },
        });
        return { year, month, revenue: Number(total._sum.totalAmount ?? 0) };
      })
    );

    const salesByType = await prisma.sale.groupBy({
      by: ['status'],
      _count: { id: true },
      where: { createdAt: { gte: startOfMonth } },
    });

    res.json({
      success: true,
      data: {
        kpis: {
          currentRevenue,
          revenueTrend: Math.round(revenueTrend * 10) / 10,
          activeEmployees,
          pendingOrders,
          lowStockAlerts: Number((lowStockCount as [{ count: bigint }])[0]?.count ?? 0),
          outstandingReceivables: outstanding,
          batchesThisMonth,
        },
        charts: {
          monthlyProduction,
          monthlyRevenue,
          salesByType,
        },
        recentActivity: recentAuditLogs,
      },
    });
  } catch (err) { next(err); }
});

// ─── PRODUCTION REPORT ────────────────────────────────────────

router.get('/reports/production', reportDataLimiter, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const from = req.query['from'] ? new Date(req.query['from'] as string) : new Date(new Date().getFullYear(), 0, 1);
    const to = req.query['to'] ? new Date(req.query['to'] as string) : new Date();

    const [batches, outputsByProduct] = await Promise.all([
      prisma.productionBatch.findMany({
        where: { createdAt: { gte: from, lte: to } },
        include: { kiln: { select: { name: true } }, outputs: { include: { product: { select: { name: true, unit: true } } } } },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.batchOutput.groupBy({
        by: ['productId'],
        where: { batch: { createdAt: { gte: from, lte: to } } },
        _sum: { planned: true, produced: true, rejected: true },
      }),
    ]);

    const productIds = outputsByProduct.map((o) => o.productId);
    const products = await prisma.productType.findMany({ where: { id: { in: productIds } }, select: { id: true, name: true, unit: true } });
    const productMap = Object.fromEntries(products.map((p) => [p.id, p]));

    const summary = outputsByProduct.map((o) => ({
      product: productMap[o.productId],
      planned: Number(o._sum.planned ?? 0),
      produced: Number(o._sum.produced ?? 0),
      rejected: Number(o._sum.rejected ?? 0),
      efficiency: o._sum.planned ? ((Number(o._sum.produced ?? 0) / Number(o._sum.planned)) * 100).toFixed(1) : '0',
    }));

    res.json({ success: true, data: { batches, summary, from, to } });
  } catch (err) { next(err); }
});

// ─── SALES REPORT ─────────────────────────────────────────────

router.get('/reports/sales', reportDataLimiter, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const from = req.query['from'] ? new Date(req.query['from'] as string) : new Date(new Date().getFullYear(), 0, 1);
    const to = req.query['to'] ? new Date(req.query['to'] as string) : new Date();

    const [sales, byCustomerType, totalAgg] = await Promise.all([
      prisma.sale.findMany({
        where: { saleDate: { gte: from, lte: to }, status: { not: 'CANCELLED' } },
        include: { customer: { select: { name: true, type: true } } },
        orderBy: { saleDate: 'desc' },
      }),
      prisma.sale.groupBy({
        by: ['paymentStatus'],
        where: { saleDate: { gte: from, lte: to }, status: { not: 'CANCELLED' } },
        _count: { id: true },
        _sum: { totalAmount: true },
      }),
      prisma.sale.aggregate({
        where: { saleDate: { gte: from, lte: to }, status: { not: 'CANCELLED' } },
        _sum: { totalAmount: true, amountPaid: true, vatAmount: true },
        _count: { id: true },
      }),
    ]);

    res.json({ success: true, data: { sales, byPaymentStatus: byCustomerType, totals: totalAgg, from, to } });
  } catch (err) { next(err); }
});

// ─── INVENTORY REPORT ─────────────────────────────────────────

router.get('/reports/inventory', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const materials = await prisma.rawMaterial.findMany({ orderBy: { name: 'asc' } });
    const totalValue = materials.reduce((acc, m) => acc + Number(m.currentStock) * Number(m.unitCost), 0);
    const lowStock = materials.filter((m) => Number(m.currentStock) <= Number(m.reorderLevel));
    res.json({ success: true, data: { materials, totalValue, lowStockCount: lowStock.length, lowStock } });
  } catch (err) { next(err); }
});

// ─── PAYROLL REPORT ───────────────────────────────────────────

router.get('/reports/payroll', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const month = req.query['month'] ? parseInt(req.query['month'] as string, 10) : new Date().getMonth() + 1;
    const year = req.query['year'] ? parseInt(req.query['year'] as string, 10) : new Date().getFullYear();

    const run = await prisma.payrollRun.findUnique({
      where: { month_year: { month, year } },
      include: { entries: { include: { employee: { include: { department: { select: { name: true } } } } } } },
    });

    const byDept: Record<string, { name: string; count: number; total: number }> = {};
    if (run) {
      for (const e of run.entries) {
        const dept = e.employee.department.name;
        if (!byDept[dept]) byDept[dept] = { name: dept, count: 0, total: 0 };
        byDept[dept].count++;
        byDept[dept].total += Number(e.netSalary);
      }
    }

    res.json({ success: true, data: { run, byDepartment: Object.values(byDept), month, year } });
  } catch (err) { next(err); }
});

// ─── PROFIT & LOSS ────────────────────────────────────────────

router.get('/reports/profit-loss', reportDataLimiter, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const from = req.query['from'] ? new Date(req.query['from'] as string) : new Date(new Date().getFullYear(), 0, 1);
    const to = req.query['to'] ? new Date(req.query['to'] as string) : new Date();

    const [revenueAgg, expensesAgg, payrollAgg] = await Promise.all([
      prisma.sale.aggregate({
        where: { saleDate: { gte: from, lte: to }, status: { not: 'CANCELLED' } },
        _sum: { subtotal: true, vatAmount: true, totalAmount: true },
      }),
      prisma.expense.aggregate({ where: { date: { gte: from, lte: to } }, _sum: { amount: true }, _count: { id: true } }),
      prisma.payrollEntry.aggregate({ where: { payrollRun: { createdAt: { gte: from, lte: to } } }, _sum: { netSalary: true } }),
    ]);

    const revenue = Number(revenueAgg._sum.totalAmount ?? 0);
    const expenses = Number(expensesAgg._sum.amount ?? 0);
    const payroll = Number(payrollAgg._sum.netSalary ?? 0);
    const totalCosts = expenses + payroll;
    const grossProfit = revenue - totalCosts;

    res.json({
      success: true,
      data: {
        revenue,
        vatCollected: Number(revenueAgg._sum.vatAmount ?? 0),
        expenses,
        payroll,
        totalCosts,
        grossProfit,
        margin: revenue > 0 ? ((grossProfit / revenue) * 100).toFixed(2) : '0.00',
        from,
        to,
      },
    });
  } catch (err) { next(err); }
});

// ─── EXCEL EXPORTS ────────────────────────────────────────────

router.get('/reports/export/sales', exportLimiter, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const from = req.query['from'] ? new Date(req.query['from'] as string) : new Date(new Date().getFullYear(), 0, 1);
    const to = req.query['to'] ? new Date(req.query['to'] as string) : new Date();

    const sales = await prisma.sale.findMany({
      where: { saleDate: { gte: from, lte: to } },
      include: { customer: { select: { name: true, type: true } } },
      orderBy: { saleDate: 'asc' },
    });

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Sales Report');
    ws.addRow(['Invoice #', 'Date', 'Customer', 'Status', 'Payment', 'Subtotal', 'VAT', 'Total', 'Paid']).font = { bold: true };
    sales.forEach((s) => {
      ws.addRow([s.invoiceNumber, s.saleDate.toISOString().slice(0, 10), s.customer.name, s.status, s.paymentStatus, Number(s.subtotal), Number(s.vatAmount), Number(s.totalAmount), Number(s.amountPaid)]);
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="sales-report.xlsx"');
    await wb.xlsx.write(res);
    res.end();
  } catch (err) { next(err); }
});

router.get('/reports/export/production', exportLimiter, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const from = req.query['from'] ? new Date(req.query['from'] as string) : new Date(new Date().getFullYear(), 0, 1);
    const to = req.query['to'] ? new Date(req.query['to'] as string) : new Date();

    const batches = await prisma.productionBatch.findMany({
      where: { createdAt: { gte: from, lte: to } },
      include: { kiln: { select: { name: true } }, outputs: { include: { product: { select: { name: true } } } } },
      orderBy: { plannedStartDate: 'asc' },
    });

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Production Report');
    ws.addRow(['Batch #', 'Kiln', 'Status', 'Planned Start', 'Completion', 'Product', 'Planned', 'Produced', 'Rejected']).font = { bold: true };
    batches.forEach((b) => {
      if (b.outputs.length === 0) {
        ws.addRow([b.batchNumber, b.kiln.name, b.status, b.plannedStartDate?.toISOString().slice(0, 10), b.completionDate?.toISOString().slice(0, 10), '', 0, 0, 0]);
      } else {
        b.outputs.forEach((o) => {
          ws.addRow([b.batchNumber, b.kiln.name, b.status, b.plannedStartDate?.toISOString().slice(0, 10), b.completionDate?.toISOString().slice(0, 10), o.product.name, o.planned, o.produced, o.rejected]);
        });
      }
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="production-report.xlsx"');
    await wb.xlsx.write(res);
    res.end();
  } catch (err) { next(err); }
});
