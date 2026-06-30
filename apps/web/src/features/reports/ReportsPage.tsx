import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '@/lib/axios';
import { PageHeader } from '@/components/shared/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatCurrency } from '@/lib/utils';
import { Factory, ShoppingCart, TrendingUp, ArrowRight, Users, AlertTriangle, Package } from 'lucide-react';

interface DashboardData {
  kpis: {
    currentRevenue: number;
    revenueTrend: number;
    activeEmployees: number;
    pendingOrders: number;
    lowStockAlerts: number;
    outstandingReceivables: number;
    batchesThisMonth: number;
  };
}

const REPORT_LINKS = [
  { to: '/reports/production', icon: Factory, title: 'Production Report', description: 'Batch output, yields, and efficiency by product' },
  { to: '/reports/sales', icon: ShoppingCart, title: 'Sales Report', description: 'Revenue, payment status, and customer breakdown' },
  { to: '/reports/profit-loss', icon: TrendingUp, title: 'Profit & Loss', description: 'Revenue, expenses, payroll, and margin' },
];

export default function ReportsPage() {
  useEffect(() => {
    document.title = 'Reports | OMNES ERP';
    return () => { document.title = 'OMNES ERP'; };
  }, []);
  const { data } = useQuery({
    queryKey: ['reports-dashboard'],
    queryFn: async () => {
      const res = await api.get('/reports/dashboard');
      return res.data.data as DashboardData;
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Reports Hub" breadcrumbs={[{ label: 'Reports' }]} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-brand-muted">Revenue (This Month)</CardTitle></CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-dark">{formatCurrency(data?.kpis.currentRevenue ?? 0)}</div>
            <p className="text-xs text-brand-muted mt-1">{(data?.kpis.revenueTrend ?? 0) >= 0 ? '+' : ''}{data?.kpis.revenueTrend ?? 0}% vs last month</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-brand-muted">Active Employees</CardTitle></CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-dark flex items-center gap-2"><Users className="h-5 w-5 text-secondary" />{data?.kpis.activeEmployees ?? 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-brand-muted">Outstanding Receivables</CardTitle></CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-dark">{formatCurrency(data?.kpis.outstandingReceivables ?? 0)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-brand-muted">Low Stock Alerts</CardTitle></CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-dark flex items-center gap-2">
              {(data?.kpis.lowStockAlerts ?? 0) > 0 && <AlertTriangle className="h-5 w-5 text-destructive" />}
              {data?.kpis.lowStockAlerts ?? 0}
            </div>
          </CardContent>
        </Card>
      </div>

      <div>
        <h3 className="text-lg font-semibold text-dark mb-3 flex items-center gap-2"><Package className="h-5 w-5" /> Batches This Month: {data?.kpis.batchesThisMonth ?? 0}</h3>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {REPORT_LINKS.map((r) => (
          <Link key={r.to} to={r.to}>
            <Card className="transition-colors hover:border-primary/50 hover:bg-primary/5">
              <CardContent className="p-6">
                <div className="flex items-start justify-between">
                  <r.icon className="h-8 w-8 text-primary" />
                  <ArrowRight className="h-4 w-4 text-brand-muted" />
                </div>
                <h4 className="mt-4 font-semibold text-dark">{r.title}</h4>
                <p className="mt-1 text-sm text-brand-muted">{r.description}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
