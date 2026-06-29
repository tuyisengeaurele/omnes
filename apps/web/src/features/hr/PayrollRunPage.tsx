import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { api } from '@/lib/axios';
import { PageHeader } from '@/components/shared/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { formatCurrency, formatDate } from '@/lib/utils';
import { CheckCircle, Download } from 'lucide-react';

const createSchema = z.object({
  periodStart: z.string().min(1),
  periodEnd: z.string().min(1),
  payDate: z.string().min(1),
});
type CreateForm = z.infer<typeof createSchema>;

interface Payslip {
  id: string;
  grossSalary: string;
  totalDeductions: string;
  netSalary: string;
  employee: { firstName: string; lastName: string; employeeNumber: string; position: string };
}

interface PayrollRunDetail {
  id: string;
  periodStart: string;
  periodEnd: string;
  payDate: string;
  status: string;
  totalGross: string;
  totalNet: string;
  payslips: Payslip[];
}

const STATUS_COLORS: Record<string, 'warning' | 'success' | 'secondary'> = {
  DRAFT: 'warning',
  APPROVED: 'success',
  PAID: 'secondary',
};

function NewPayrollRunForm() {
  const qc = useQueryClient();
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<CreateForm>({
    resolver: zodResolver(createSchema),
  });

  const mutation = useMutation({
    mutationFn: (values: CreateForm) => api.post('/payroll', values),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['payroll-runs'] }),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="New Payroll Run"
        breadcrumbs={[{ label: 'HR' }, { label: 'Payroll', href: '/hr/payroll' }, { label: 'New Run' }]}
      />
      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle className="text-base">Payroll Period</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
            <div className="space-y-1">
              <Label>Period Start *</Label>
              <Input type="date" {...register('periodStart')} />
              {errors.periodStart && <p className="text-xs text-destructive">Required</p>}
            </div>
            <div className="space-y-1">
              <Label>Period End *</Label>
              <Input type="date" {...register('periodEnd')} />
              {errors.periodEnd && <p className="text-xs text-destructive">Required</p>}
            </div>
            <div className="space-y-1">
              <Label>Pay Date *</Label>
              <Input type="date" {...register('payDate')} />
              {errors.payDate && <p className="text-xs text-destructive">Required</p>}
            </div>
            {mutation.isSuccess && (
              <div className="rounded-md bg-brand-success/10 border border-brand-success/20 px-4 py-3 text-sm text-brand-success">
                Payroll run created! Check the Payroll list.
              </div>
            )}
            {mutation.isError && (
              <div className="rounded-md bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">
                Failed to create payroll run.
              </div>
            )}
            <Button type="submit" disabled={isSubmitting || mutation.isPending}>
              {mutation.isPending ? 'Creating...' : 'Create Payroll Run'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function PayrollRunDetail({ id }: { id: string }) {
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['payroll-run', id],
    queryFn: async () => {
      const res = await api.get(`/payroll/${id}`);
      return res.data.data as PayrollRunDetail;
    },
  });

  const approveMutation = useMutation({
    mutationFn: () => api.patch(`/payroll/${id}/approve`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['payroll-run', id] }),
  });

  const handleExport = async () => {
    const res = await api.get(`/payroll/${id}/export`, { responseType: 'blob' });
    const url = URL.createObjectURL(new Blob([res.data]));
    const a = document.createElement('a');
    a.href = url;
    a.download = `payroll-${id}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading) return <div className="p-8 text-center text-brand-muted">Loading...</div>;
  if (!data) return null;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Payroll: ${formatDate(data.periodStart)} to ${formatDate(data.periodEnd)}`}
        breadcrumbs={[{ label: 'HR' }, { label: 'Payroll', href: '/hr/payroll' }, { label: 'Detail' }]}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleExport}>
              <Download className="h-4 w-4" /> Export BK
            </Button>
            {data.status === 'DRAFT' && (
              <Button onClick={() => approveMutation.mutate()} disabled={approveMutation.isPending}>
                <CheckCircle className="h-4 w-4" /> Approve
              </Button>
            )}
          </div>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card><CardContent className="pt-6"><p className="text-sm text-brand-muted">Status</p><div className="mt-1"><Badge variant={STATUS_COLORS[data.status] ?? 'outline'}>{data.status}</Badge></div></CardContent></Card>
        <Card><CardContent className="pt-6"><p className="text-sm text-brand-muted">Pay Date</p><p className="text-lg font-bold mt-1">{formatDate(data.payDate)}</p></CardContent></Card>
        <Card><CardContent className="pt-6"><p className="text-sm text-brand-muted">Total Gross</p><p className="text-lg font-bold mt-1">{formatCurrency(Number(data.totalGross))}</p></CardContent></Card>
        <Card><CardContent className="pt-6"><p className="text-sm text-brand-muted">Total Net</p><p className="text-lg font-bold mt-1">{formatCurrency(Number(data.totalNet))}</p></CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Payslips ({data.payslips.length})</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/30">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-brand-muted">Employee</th>
                  <th className="px-4 py-3 text-left font-medium text-brand-muted">Position</th>
                  <th className="px-4 py-3 text-right font-medium text-brand-muted">Gross</th>
                  <th className="px-4 py-3 text-right font-medium text-brand-muted">Deductions</th>
                  <th className="px-4 py-3 text-right font-medium text-brand-muted">Net</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.payslips.map((p) => (
                  <tr key={p.id} className="hover:bg-muted/20">
                    <td className="px-4 py-3">
                      <p className="font-medium">{p.employee.firstName} {p.employee.lastName}</p>
                      <p className="text-xs text-brand-muted font-mono">{p.employee.employeeNumber}</p>
                    </td>
                    <td className="px-4 py-3 text-brand-muted">{p.employee.position}</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(Number(p.grossSalary))}</td>
                    <td className="px-4 py-3 text-right text-destructive">-{formatCurrency(Number(p.totalDeductions))}</td>
                    <td className="px-4 py-3 text-right font-medium">{formatCurrency(Number(p.netSalary))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function PayrollRunPage() {
  const { id } = useParams<{ id?: string }>();
  if (!id || id === 'run') return <NewPayrollRunForm />;
  return <PayrollRunDetail id={id} />;
}
