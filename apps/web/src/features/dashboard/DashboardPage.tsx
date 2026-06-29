import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/axios';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatCurrency, formatDateTime } from '@/lib/utils';
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import {
  TrendingUp, TrendingDown, Users, Package, ShoppingCart,
  AlertTriangle, DollarSign, Factory,
} from 'lucide-react';

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
  charts: {
    monthlyProduction: Array<{ year: number; month: number; produced: number }>;
    monthlyRevenue: Array<{ year: number; month: number; revenue: number }>;
    salesByType: Array<{ status: string; _count: { id: number } }>;
  };
  recentActivity: Array<{
    id: string;
    action: string;
    entity: string;
    entityId: string | null;
    createdAt: string;
    user: { firstName: string; lastName: string };
  }>;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const COLORS = ['#C0392B', '#E67E22', '#27AE60', '#3498DB', '#9B59B6', '#1ABC9C'];

function KpiCard({ title, value, subtitle, icon: Icon, trend }: {
  title: string; value: string; subtitle?: string; icon: React.ElementType; trend?: number;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm font-medium text-brand-muted">{title}</p>
            <p className="text-2xl font-bold text-dark mt-1">{value}</p>
            {subtitle && <p className="text-xs text-brand-muted mt-0.5">{subtitle}</p>}
          </div>
          <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
            <Icon className="h-5 w-5 text-primary" />
          </div>
        </div>
        {trend !== undefined && (
          <div className="mt-3 flex items-center gap-1 text-xs">
            {trend >= 0 ? (
              <TrendingUp className="h-3 w-3 text-brand-success" />
            ) : (
              <TrendingDown className="h-3 w-3 text-brand-danger" />
            )}
            <span className={trend >= 0 ? 'text-brand-success' : 'text-brand-danger'}>
              {Math.abs(trend).toFixed(1)}% vs last month
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: async () => {
      const res = await api.get('/reports/dashboard');
      return res.data.data as DashboardData;
    },
    refetchInterval: 60000,
  });

  const productionData = data?.charts.monthlyProduction.map((m) => ({
    name: MONTHS[m.month - 1],
    produced: m.produced,
  })) ?? [];

  const revenueData = data?.charts.monthlyRevenue.map((m) => ({
    name: MONTHS[m.month - 1],
    revenue: m.revenue,
  })) ?? [];

  const salesTypeData = data?.charts.salesByType.map((s) => ({
    name: s.status,
    value: s._count.id,
  })) ?? [];

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-dark">Dashboard</h1>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i}><CardContent className="pt-6"><div className="h-16 bg-muted animate-pulse rounded" /></CardContent></Card>
          ))}
        </div>
      </div>
    );
  }

  const kpis = data?.kpis;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-dark">Dashboard</h1>
        <p className="text-sm text-brand-muted mt-1">
          {new Date().toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <KpiCard
          title="Revenue (This Month)"
          value={formatCurrency(kpis?.currentRevenue ?? 0)}
          icon={DollarSign}
          trend={kpis?.revenueTrend}
        />
        <KpiCard
          title="Active Employees"
          value={String(kpis?.activeEmployees ?? 0)}
          icon={Users}
        />
        <KpiCard
          title="Pending Orders"
          value={String(kpis?.pendingOrders ?? 0)}
          subtitle="Proforma & Confirmed"
          icon={ShoppingCart}
        />
        <KpiCard
          title="Low Stock Alerts"
          value={String(kpis?.lowStockAlerts ?? 0)}
          icon={AlertTriangle}
        />
        <KpiCard
          title="Outstanding"
          value={formatCurrency(kpis?.outstandingReceivables ?? 0)}
          subtitle="Receivables"
          icon={Package}
        />
        <KpiCard
          title="Batches (Month)"
          value={String(kpis?.batchesThisMonth ?? 0)}
          icon={Factory}
        />
      </div>

      {/* Charts Row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Monthly Production Output</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={productionData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip formatter={(v) => [Number(v).toLocaleString(), 'Units']} />
                <Bar dataKey="produced" fill="#C0392B" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Revenue Trend (6 Months)</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={revenueData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `${(Number(v) / 1000000).toFixed(1)}M`} />
                <Tooltip formatter={(v) => [formatCurrency(Number(v)), 'Revenue']} />
                <Line type="monotone" dataKey="revenue" stroke="#C0392B" strokeWidth={2} dot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Charts Row 2 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Sales by Status</CardTitle>
          </CardHeader>
          <CardContent>
            {salesTypeData.length === 0 ? (
              <div className="h-48 flex items-center justify-center text-brand-muted text-sm">No sales data this month</div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={salesTypeData} cx="50%" cy="50%" outerRadius={80} dataKey="value" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                    {salesTypeData.map((_, index) => (
                      <Cell key={index} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent Activity</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3 max-h-52 overflow-y-auto">
              {data?.recentActivity.length === 0 && (
                <p className="text-sm text-brand-muted text-center py-8">No recent activity</p>
              )}
              {data?.recentActivity.map((log) => (
                <div key={log.id} className="flex items-start gap-3 text-sm">
                  <div className="h-2 w-2 rounded-full bg-primary mt-1.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <span className="font-medium">{log.user.firstName} {log.user.lastName}</span>
                    {' '}
                    <span className="text-brand-muted">{log.action.toLowerCase()}</span>
                    {' '}
                    <span className="font-medium">{log.entity}</span>
                    {log.entityId && <span className="text-brand-muted"> #{log.entityId.slice(-6)}</span>}
                  </div>
                  <span className="text-xs text-brand-muted shrink-0">{formatDateTime(log.createdAt)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
