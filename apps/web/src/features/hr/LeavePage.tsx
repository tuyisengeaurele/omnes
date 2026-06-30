import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/axios';
import { DataTable, type Column } from '@/components/shared/DataTable';
import { PageHeader } from '@/components/shared/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, CheckCircle, XCircle } from 'lucide-react';
import { formatDate } from '@/lib/utils';
import { useAuth } from '@/features/auth/AuthContext';
import { toast } from 'sonner';

interface Leave {
  id: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  reason: string;
  status: string;
  employee: { firstName: string; lastName: string; employeeNumber: string };
}

const schema = z.object({
  employeeId: z.string().min(1),
  leaveType: z.enum(['ANNUAL', 'SICK', 'MATERNITY', 'PATERNITY', 'UNPAID', 'OTHER']),
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  reason: z.string().min(1),
});
type FormValues = z.infer<typeof schema>;

const STATUS_COLORS: Record<string, 'warning' | 'success' | 'destructive' | 'secondary'> = {
  PENDING: 'warning',
  APPROVED: 'success',
  REJECTED: 'destructive',
  CANCELLED: 'secondary',
};

export default function LeavePage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [approveId, setApproveId] = useState<string | null>(null);
  const [rejectId, setRejectId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['leaves', page, search],
    queryFn: async () => {
      const res = await api.get('/leaves', { params: { page, pageSize: 20, search } });
      return res.data as { data: Leave[]; total: number; page: number; pageSize: number };
    },
  });

  const { data: employees } = useQuery({
    queryKey: ['employees-list'],
    queryFn: async () => {
      const res = await api.get('/employees', { params: { pageSize: 200 } });
      return res.data.data as Array<{ id: string; firstName: string; lastName: string }>;
    },
  });

  const { register, handleSubmit, control, reset, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { leaveType: 'ANNUAL' },
  });

  const mutation = useMutation({
    mutationFn: (values: FormValues) => api.post('/leaves', values),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['leaves'] });
      setDialogOpen(false);
      reset();
      toast.success('Leave request submitted.');
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Something went wrong. Please try again.';
      toast.error(msg);
    },
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/leaves/${id}/approve`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['leaves'] });
      setApproveId(null);
      toast.success('Leave approved.');
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Something went wrong. Please try again.';
      toast.error(msg);
    },
  });

  const rejectMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/leaves/${id}/reject`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['leaves'] });
      setRejectId(null);
      toast.success('Leave rejected.');
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Something went wrong. Please try again.';
      toast.error(msg);
    },
  });

  const isManager = user?.role === 'ADMIN' || user?.role === 'MANAGER';

  const columns: Column<Leave>[] = [
    { key: 'employee', header: 'Employee', render: (r) => `${r.employee.firstName} ${r.employee.lastName}` },
    { key: 'leaveType', header: 'Type', render: (r) => <Badge variant="outline">{r.leaveType}</Badge> },
    { key: 'startDate', header: 'Start', render: (r) => formatDate(r.startDate) },
    { key: 'endDate', header: 'End', render: (r) => formatDate(r.endDate) },
    { key: 'reason', header: 'Reason', className: 'max-w-xs truncate' },
    { key: 'status', header: 'Status', render: (r) => <Badge variant={STATUS_COLORS[r.status] ?? 'outline'}>{r.status}</Badge> },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Leave Requests"
        breadcrumbs={[{ label: 'HR' }, { label: 'Leave' }]}
        actions={
          <Button onClick={() => { reset({ leaveType: 'ANNUAL' }); setDialogOpen(true); }}>
            <Plus className="h-4 w-4" /> New Request
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
        searchPlaceholder="Search by employee..."
        actions={(row) =>
          isManager && row.status === 'PENDING' ? (
            <div className="flex items-center justify-end gap-1">
              <Button variant="ghost" size="icon" className="text-brand-success" onClick={() => setApproveId(row.id)}>
                <CheckCircle className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" className="text-destructive" onClick={() => setRejectId(row.id)}>
                <XCircle className="h-4 w-4" />
              </Button>
            </div>
          ) : null
        }
      />

      <Dialog open={dialogOpen} onOpenChange={(o) => { setDialogOpen(o); if (!o) reset(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Leave Request</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit((v) => mutation.mutate(v))} className="space-y-4 mt-2">
            <div className="space-y-1">
              <Label>Employee *</Label>
              <Controller name="employeeId" control={control} render={({ field }) => (
                <Select onValueChange={field.onChange} value={field.value}>
                  <SelectTrigger><SelectValue placeholder="Select employee" /></SelectTrigger>
                  <SelectContent>
                    {employees?.map((e) => <SelectItem key={e.id} value={e.id}>{e.firstName} {e.lastName}</SelectItem>)}
                  </SelectContent>
                </Select>
              )} />
              {errors.employeeId && <p className="text-xs text-destructive">Required</p>}
            </div>
            <div className="space-y-1">
              <Label>Leave Type *</Label>
              <Controller name="leaveType" control={control} render={({ field }) => (
                <Select onValueChange={field.onChange} value={field.value}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {['ANNUAL', 'SICK', 'MATERNITY', 'PATERNITY', 'UNPAID', 'OTHER'].map((t) => (
                      <SelectItem key={t} value={t}>{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Start Date *</Label>
                <Input type="date" {...register('startDate')} />
              </div>
              <div className="space-y-1">
                <Label>End Date *</Label>
                <Input type="date" {...register('endDate')} />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Reason *</Label>
              <Input {...register('reason')} />
              {errors.reason && <p className="text-xs text-destructive">{errors.reason.message}</p>}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={isSubmitting || mutation.isPending}>
                {mutation.isPending ? 'Submitting...' : 'Submit'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!approveId}
        onOpenChange={(o) => !o && setApproveId(null)}
        title="Approve Leave"
        description="Approve this leave request?"
        confirmLabel="Approve"
        onConfirm={() => approveId && approveMutation.mutate(approveId)}
        isLoading={approveMutation.isPending}
      />
      <ConfirmDialog
        open={!!rejectId}
        onOpenChange={(o) => !o && setRejectId(null)}
        title="Reject Leave"
        description="Reject this leave request?"
        confirmLabel="Reject"
        onConfirm={() => rejectId && rejectMutation.mutate(rejectId)}
        isLoading={rejectMutation.isPending}
      />
    </div>
  );
}
