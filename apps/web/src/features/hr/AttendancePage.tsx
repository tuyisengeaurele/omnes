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
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus } from 'lucide-react';
import { formatDate } from '@/lib/utils';

interface Attendance {
  id: string;
  date: string;
  checkIn: string | null;
  checkOut: string | null;
  status: string;
  employee: { firstName: string; lastName: string; employeeNumber: string };
}

const schema = z.object({
  employeeId: z.string().min(1),
  date: z.string().min(1),
  checkIn: z.string().optional(),
  checkOut: z.string().optional(),
  status: z.enum(['PRESENT', 'ABSENT', 'HALF_DAY', 'HOLIDAY', 'LEAVE']),
  notes: z.string().optional(),
});
type FormValues = z.infer<typeof schema>;

const STATUS_COLORS: Record<string, 'success' | 'destructive' | 'warning' | 'secondary' | 'outline'> = {
  PRESENT: 'success',
  ABSENT: 'destructive',
  HALF_DAY: 'warning',
  HOLIDAY: 'secondary',
  LEAVE: 'outline',
};

export default function AttendancePage() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['attendance', page, search],
    queryFn: async () => {
      const res = await api.get('/attendance', { params: { page, pageSize: 20, search } });
      return res.data as { data: Attendance[]; total: number; page: number; pageSize: number };
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
    defaultValues: { date: new Date().toISOString().split('T')[0], status: 'PRESENT' },
  });

  const mutation = useMutation({
    mutationFn: (values: FormValues) => api.post('/attendance', values),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['attendance'] });
      setDialogOpen(false);
      reset();
    },
  });

  const columns: Column<Attendance>[] = [
    { key: 'employee', header: 'Employee', render: (r) => `${r.employee.firstName} ${r.employee.lastName}` },
    { key: 'empNo', header: 'Emp #', render: (r) => <span className="font-mono text-xs">{r.employee.employeeNumber}</span> },
    { key: 'date', header: 'Date', render: (r) => formatDate(r.date) },
    { key: 'checkIn', header: 'Check In', render: (r) => r.checkIn ? r.checkIn.slice(11, 16) : '—' },
    { key: 'checkOut', header: 'Check Out', render: (r) => r.checkOut ? r.checkOut.slice(11, 16) : '—' },
    { key: 'status', header: 'Status', render: (r) => <Badge variant={STATUS_COLORS[r.status] ?? 'outline'}>{r.status}</Badge> },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Attendance"
        breadcrumbs={[{ label: 'HR' }, { label: 'Attendance' }]}
        actions={
          <Button onClick={() => { reset({ date: new Date().toISOString().split('T')[0], status: 'PRESENT' }); setDialogOpen(true); }}>
            <Plus className="h-4 w-4" /> Record Attendance
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
      />

      <Dialog open={dialogOpen} onOpenChange={(o) => { setDialogOpen(o); if (!o) reset(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record Attendance</DialogTitle>
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
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Date *</Label>
                <Input type="date" {...register('date')} />
              </div>
              <div className="space-y-1">
                <Label>Status *</Label>
                <Controller name="status" control={control} render={({ field }) => (
                  <Select onValueChange={field.onChange} value={field.value}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {['PRESENT', 'ABSENT', 'HALF_DAY', 'HOLIDAY', 'LEAVE'].map((s) => (
                        <SelectItem key={s} value={s}>{s.replace('_', ' ')}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )} />
              </div>
              <div className="space-y-1">
                <Label>Check In</Label>
                <Input type="time" {...register('checkIn')} />
              </div>
              <div className="space-y-1">
                <Label>Check Out</Label>
                <Input type="time" {...register('checkOut')} />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Notes</Label>
              <Input {...register('notes')} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={isSubmitting || mutation.isPending}>
                {mutation.isPending ? 'Saving...' : 'Record'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
