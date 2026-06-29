import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/axios';
import { PageHeader } from '@/components/shared/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Download } from 'lucide-react';
import { formatCurrency, formatDate } from '@/lib/utils';

interface SaleRow {
  id: string;
  invoiceNumber: string | null;
  proformaNumber: string | null;
  saleDate: string;
  status: string;
  paymentStatus: string;
  totalAmount: string;
  amountPaid: string;
  customer: { name: string; type: string };
}

interface ByPaymentStatus {
  paymentStatus: string;
  _count: { id: number };
  _sum: { totalAmount: string | null };
}

interface Totals {
  _sum: { totalAmount: string | null; amountPaid: string | null; vatAmount: string | null };
  _count: { id: number };
}

const PAYMENT_COLORS: Record<string, 'success' | 'warning' | 'destructive'> = {
  PAID: 'success',
  PARTIAL: 'warning',
  UNPAID: 'destructive',
};

const defaultFrom = `${new Date().getFullYear()}-01-01`;
const defaultTo = new Date().toISOString().split('T')[0];

export default function SalesReportPage() {
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);

  const { data, isLoading } = useQuery({
    queryKey: ['sales-report', from, to],
    queryFn: async () => {
      const res = await api.get('/reports/sales', { params: { from, to } });
      return res.data.data as { sales: SaleRow[]; byPaymentStatus: ByPaymentStatus[]; totals: Totals };
    },
  });

  const handleExport = async () => {
    const res = await api.get('/reports/export/sales', { params: { from, to }, responseType: 'blob' });
    const url = URL.createObjectURL(new Blob([res.data]));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sales-report.xlsx';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sales Report"
        breadcrumbs={[{ label: 'Reports' }, { label: 'Sales' }]}
        actions={<Button onClick={handleExport}><Download className="h-4 w-4" /> Export Excel</Button>}
      />

      <Card>
        <CardContent className="p-4 flex flex-wrap items-end gap-4">
          <div className="space-y-1">
            <Label>From</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>To</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-brand-muted">Total Sales</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold text-dark">{data?.totals._count.id ?? 0}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-brand-muted">Total Revenue</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold text-dark">{formatCurrency(Number(data?.totals._sum.totalAmount ?? 0))}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-brand-muted">Amount Collected</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold text-dark">{formatCurrency(Number(data?.totals._sum.amountPaid ?? 0))}</div></CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-4">
          <h3 className="font-semibold text-dark mb-3">By Payment Status</h3>
          <div className="flex flex-wrap gap-4">
            {(data?.byPaymentStatus ?? []).map((b) => (
              <div key={b.paymentStatus} className="flex items-center gap-2 rounded-md border px-3 py-2">
                <Badge variant={PAYMENT_COLORS[b.paymentStatus] ?? 'outline'}>{b.paymentStatus}</Badge>
                <span className="text-sm text-brand-muted">{b._count.id} sales · {formatCurrency(Number(b._sum.totalAmount ?? 0))}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <h3 className="font-semibold text-dark mb-3">Sales</h3>
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/30">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-brand-muted">Invoice/Proforma</th>
                <th className="px-3 py-2 text-left font-medium text-brand-muted">Date</th>
                <th className="px-3 py-2 text-left font-medium text-brand-muted">Customer</th>
                <th className="px-3 py-2 text-left font-medium text-brand-muted">Payment</th>
                <th className="px-3 py-2 text-right font-medium text-brand-muted">Total</th>
                <th className="px-3 py-2 text-right font-medium text-brand-muted">Paid</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {(data?.sales ?? []).map((s) => (
                <tr key={s.id}>
                  <td className="px-3 py-2 font-mono text-xs">{s.invoiceNumber ?? s.proformaNumber}</td>
                  <td className="px-3 py-2">{formatDate(s.saleDate)}</td>
                  <td className="px-3 py-2">{s.customer.name}</td>
                  <td className="px-3 py-2"><Badge variant={PAYMENT_COLORS[s.paymentStatus] ?? 'outline'}>{s.paymentStatus}</Badge></td>
                  <td className="px-3 py-2 text-right">{formatCurrency(Number(s.totalAmount))}</td>
                  <td className="px-3 py-2 text-right">{formatCurrency(Number(s.amountPaid))}</td>
                </tr>
              ))}
              {!isLoading && (data?.sales ?? []).length === 0 && (
                <tr><td colSpan={6} className="px-3 py-8 text-center text-brand-muted">No sales for this period</td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
