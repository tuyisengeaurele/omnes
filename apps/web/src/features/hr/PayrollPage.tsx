import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/axios';
import { DataTable, type Column } from '@/components/shared/DataTable';
import { PageHeader } from '@/components/shared/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';
import { Plus, Eye } from 'lucide-react';
import { formatCurrency, formatDate } from '@/lib/utils';

interface PayrollRun {
  id: string;
  periodStart: string;
  periodEnd: string;
  payDate: string;
  status: string;
  totalGross: string;
  totalNet: string;
  _count: { payslips: number };
}

const STATUS_COLORS: Record<string, 'warning' | 'success' | 'secondary'> = {
  DRAFT: 'warning',
  APPROVED: 'success',
  PAID: 'secondary',
};

export default function PayrollPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['payroll-runs', page, search],
    queryFn: async () => {
      const res = await api.get('/payroll', { params: { page, pageSize: 20, search } });
      return res.data as { data: PayrollRun[]; total: number; page: number; pageSize: number };
    },
  });

  const columns: Column<PayrollRun>[] = [
    { key: 'period', header: 'Period', render: (r) => `${formatDate(r.periodStart)} – ${formatDate(r.periodEnd)}` },
    { key: 'payDate', header: 'Pay Date', render: (r) => formatDate(r.payDate) },
    { key: 'employees', header: 'Employees', render: (r) => r._count.payslips },
    { key: 'totalGross', header: 'Gross', render: (r) => formatCurrency(Number(r.totalGross)) },
    { key: 'totalNet', header: 'Net', render: (r) => formatCurrency(Number(r.totalNet)) },
    { key: 'status', header: 'Status', render: (r) => <Badge variant={STATUS_COLORS[r.status] ?? 'outline'}>{r.status}</Badge> },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payroll"
        breadcrumbs={[{ label: 'HR' }, { label: 'Payroll' }]}
        actions={
          <Button asChild>
            <Link to="/hr/payroll/run"><Plus className="h-4 w-4" /> New Payroll Run</Link>
          </Button>
        }
      />

      <DataTable
        columns={columns}
        data={data?.data ?? []}
        total={data?.total ?? 0}
        page={page}
        pageSize={20}
        onPageChange={setPage}
        onSearch={setSearch}
        isLoading={isLoading}
        searchPlaceholder="Search payroll runs..."
        actions={(row) => (
          <div className="flex items-center justify-end">
            <Button variant="ghost" size="icon" asChild>
              <Link to={`/hr/payroll/${row.id}`}><Eye className="h-4 w-4" /></Link>
            </Button>
          </div>
        )}
      />
    </div>
  );
}
