import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/axios';
import { PageHeader } from '@/components/shared/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatCurrency } from '@/lib/utils';

interface ProfitLossData {
  revenue: number;
  vatCollected: number;
  expenses: number;
  payroll: number;
  totalCosts: number;
  grossProfit: number;
  margin: string;
}

const defaultFrom = `${new Date().getFullYear()}-01-01`;
const defaultTo = new Date().toISOString().split('T')[0];

export default function ProfitLossPage() {
  useEffect(() => {
    document.title = 'Profit & Loss | OMNES ERP';
    return () => { document.title = 'OMNES ERP'; };
  }, []);
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);

  const { data } = useQuery({
    queryKey: ['profit-loss', from, to],
    queryFn: async () => {
      const res = await api.get('/reports/profit-loss', { params: { from, to } });
      return res.data.data as ProfitLossData;
    },
  });

  const isProfit = (data?.grossProfit ?? 0) >= 0;

  return (
    <div className="space-y-6">
      <PageHeader title="Profit and Loss" breadcrumbs={[{ label: 'Reports' }, { label: 'Profit & Loss' }]} />

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

      <Card>
        <CardContent className="p-6 space-y-1">
          <div className="flex items-center justify-between py-2">
            <span className="text-brand-muted">Revenue (Sales)</span>
            <span className="font-medium text-dark">{formatCurrency(data?.revenue ?? 0)}</span>
          </div>
          <div className="flex items-center justify-between py-2 text-sm text-brand-muted">
            <span>VAT Collected (informational)</span>
            <span>{formatCurrency(data?.vatCollected ?? 0)}</span>
          </div>

          <div className="border-t my-2" />

          <div className="flex items-center justify-between py-2">
            <span className="text-brand-muted">Operating Expenses</span>
            <span className="font-medium text-destructive">({formatCurrency(data?.expenses ?? 0)})</span>
          </div>
          <div className="flex items-center justify-between py-2">
            <span className="text-brand-muted">Payroll Costs</span>
            <span className="font-medium text-destructive">({formatCurrency(data?.payroll ?? 0)})</span>
          </div>
          <div className="flex items-center justify-between py-2 font-semibold">
            <span>Total Costs</span>
            <span className="text-destructive">({formatCurrency(data?.totalCosts ?? 0)})</span>
          </div>

          <div className="border-t my-2" />

          <div className="flex items-center justify-between py-3">
            <span className="text-lg font-bold text-dark">Gross Profit</span>
            <span className={`text-lg font-bold ${isProfit ? 'text-success' : 'text-destructive'}`}>
              {formatCurrency(data?.grossProfit ?? 0)}
            </span>
          </div>
          <div className="flex items-center justify-between py-2">
            <span className="text-brand-muted">Margin</span>
            <span className="font-medium text-dark">{data?.margin ?? '0.00'}%</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
