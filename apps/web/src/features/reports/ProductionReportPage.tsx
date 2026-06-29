import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/axios';
import { PageHeader } from '@/components/shared/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Download } from 'lucide-react';
import { formatDate } from '@/lib/utils';

interface BatchRow {
  id: string;
  batchNumber: string;
  status: string;
  plannedStartDate: string | null;
  completionDate: string | null;
  kiln: { name: string };
  outputs: Array<{ planned: string; produced: string; rejected: string; product: { name: string; unit: string } }>;
}

interface SummaryRow {
  product: { id: string; name: string; unit: string } | undefined;
  planned: number;
  produced: number;
  rejected: number;
  efficiency: string;
}

const STATUS_COLORS: Record<string, 'warning' | 'secondary' | 'success' | 'destructive'> = {
  LOADING: 'secondary',
  FIRING: 'warning',
  COOLING: 'warning',
  COMPLETED: 'success',
  FAILED: 'destructive',
};

const defaultFrom = `${new Date().getFullYear()}-01-01`;
const defaultTo = new Date().toISOString().split('T')[0];

export default function ProductionReportPage() {
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);

  const { data, isLoading } = useQuery({
    queryKey: ['production-report', from, to],
    queryFn: async () => {
      const res = await api.get('/reports/production', { params: { from, to } });
      return res.data.data as { batches: BatchRow[]; summary: SummaryRow[] };
    },
  });

  const handleExport = async () => {
    const res = await api.get('/reports/export/production', { params: { from, to }, responseType: 'blob' });
    const url = URL.createObjectURL(new Blob([res.data]));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'production-report.xlsx';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Production Report"
        breadcrumbs={[{ label: 'Reports' }, { label: 'Production' }]}
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

      <Card>
        <CardContent className="p-4">
          <h3 className="font-semibold text-dark mb-3">Summary by Product</h3>
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/30">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-brand-muted">Product</th>
                <th className="px-3 py-2 text-right font-medium text-brand-muted">Planned</th>
                <th className="px-3 py-2 text-right font-medium text-brand-muted">Produced</th>
                <th className="px-3 py-2 text-right font-medium text-brand-muted">Rejected</th>
                <th className="px-3 py-2 text-right font-medium text-brand-muted">Efficiency</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {(data?.summary ?? []).map((s, i) => (
                <tr key={s.product?.id ?? i}>
                  <td className="px-3 py-2">{s.product?.name ?? 'Unknown'}</td>
                  <td className="px-3 py-2 text-right">{s.planned} {s.product?.unit}</td>
                  <td className="px-3 py-2 text-right">{s.produced} {s.product?.unit}</td>
                  <td className="px-3 py-2 text-right text-destructive">{s.rejected} {s.product?.unit}</td>
                  <td className="px-3 py-2 text-right">{s.efficiency}%</td>
                </tr>
              ))}
              {!isLoading && (data?.summary ?? []).length === 0 && (
                <tr><td colSpan={5} className="px-3 py-8 text-center text-brand-muted">No production data for this period</td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <h3 className="font-semibold text-dark mb-3">Batches</h3>
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/30">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-brand-muted">Batch #</th>
                <th className="px-3 py-2 text-left font-medium text-brand-muted">Kiln</th>
                <th className="px-3 py-2 text-left font-medium text-brand-muted">Status</th>
                <th className="px-3 py-2 text-left font-medium text-brand-muted">Started</th>
                <th className="px-3 py-2 text-left font-medium text-brand-muted">Completed</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {(data?.batches ?? []).map((b) => (
                <tr key={b.id}>
                  <td className="px-3 py-2 font-mono text-xs">{b.batchNumber}</td>
                  <td className="px-3 py-2">{b.kiln.name}</td>
                  <td className="px-3 py-2"><Badge variant={STATUS_COLORS[b.status] ?? 'outline'}>{b.status}</Badge></td>
                  <td className="px-3 py-2">{b.plannedStartDate ? formatDate(b.plannedStartDate) : '—'}</td>
                  <td className="px-3 py-2">{b.completionDate ? formatDate(b.completionDate) : '—'}</td>
                </tr>
              ))}
              {!isLoading && (data?.batches ?? []).length === 0 && (
                <tr><td colSpan={5} className="px-3 py-8 text-center text-brand-muted">No batches for this period</td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
