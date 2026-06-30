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
import { formatCurrency, formatDate } from '@/lib/utils';
import { toast } from 'sonner';

interface MaintenanceLog {
  id: string;
  description: string;
  cost: string;
  scheduledDate: string;
  status: string;
  asset: { name: string };
}

const schema = z.object({
  assetId: z.string().min(1),
  description: z.string().min(1),
  cost: z.coerce.number().nonnegative(),
  scheduledDate: z.string().min(1),
});
type FormValues = z.infer<typeof schema>;

const STATUS_COLORS: Record<string, 'warning' | 'secondary' | 'success' | 'destructive'> = {
  SCHEDULED: 'warning',
  IN_PROGRESS: 'secondary',
  COMPLETED: 'success',
  CANCELLED: 'destructive',
};
const STATUSES = ['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];

export default function MaintenancePage() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['maintenance-logs', page, search],
    queryFn: async () => {
      const res = await api.get('/maintenance-logs', { params: { page, pageSize: 20, search } });
      return res.data as { data: MaintenanceLog[]; total: number; page: number; pageSize: number };
    },
  });

  const { data: assets } = useQuery({
    queryKey: ['fixed-assets-list'],
    queryFn: async () => {
      const res = await api.get('/fixed-assets', { params: { pageSize: 100 } });
      return res.data.data as Array<{ id: string; name: string }>;
    },
  });

  const { register, handleSubmit, control, reset, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { scheduledDate: new Date().toISOString().split('T')[0] },
  });

  const mutation = useMutation({
    mutationFn: (values: FormValues) => api.post('/maintenance-logs', values),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['maintenance-logs'] });
      setDialogOpen(false);
      reset({ scheduledDate: new Date().toISOString().split('T')[0] });
      toast.success('Maintenance scheduled.');
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Something went wrong. Please try again.';
      toast.error(msg);
    },
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => api.patch(`/maintenance-logs/${id}/status`, { status }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['maintenance-logs'] });
      toast.success('Status updated.');
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Something went wrong. Please try again.';
      toast.error(msg);
    },
  });

  const columns: Column<MaintenanceLog>[] = [
    { key: 'asset', header: 'Asset', render: (r) => r.asset.name },
    { key: 'description', header: 'Description' },
    { key: 'scheduledDate', header: 'Scheduled', render: (r) => formatDate(r.scheduledDate) },
    { key: 'cost', header: 'Cost', render: (r) => formatCurrency(Number(r.cost)) },
    { key: 'status', header: 'Status', render: (r) => (
      <Select value={r.status} onValueChange={(v) => statusMutation.mutate({ id: r.id, status: v })}>
        <SelectTrigger className="h-7 w-36">
          <Badge variant={STATUS_COLORS[r.status] ?? 'outline'}>{r.status.replace('_', ' ')}</Badge>
        </SelectTrigger>
        <SelectContent>
          {STATUSES.map((s) => <SelectItem key={s} value={s}>{s.replace('_', ' ')}</SelectItem>)}
        </SelectContent>
      </Select>
    ) },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Maintenance Logs"
        breadcrumbs={[{ label: 'Assets' }, { label: 'Maintenance' }]}
        actions={
          <Button onClick={() => { reset({ scheduledDate: new Date().toISOString().split('T')[0] }); setDialogOpen(true); }}>
            <Plus className="h-4 w-4" /> Schedule Maintenance
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
        searchPlaceholder="Search maintenance logs..."
      />

      <Dialog open={dialogOpen} onOpenChange={(o) => { setDialogOpen(o); if (!o) reset({ scheduledDate: new Date().toISOString().split('T')[0] }); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Schedule Maintenance</DialogTitle></DialogHeader>
          <form onSubmit={handleSubmit((v) => mutation.mutate(v))} className="space-y-4 mt-2">
            <div className="space-y-1">
              <Label>Asset *</Label>
              <Controller name="assetId" control={control} render={({ field }) => (
                <Select onValueChange={field.onChange} value={field.value}>
                  <SelectTrigger><SelectValue placeholder="Select asset" /></SelectTrigger>
                  <SelectContent>{assets?.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
                </Select>
              )} />
              {errors.assetId && <p className="text-xs text-destructive">Required</p>}
            </div>
            <div className="space-y-1">
              <Label>Description *</Label>
              <Input {...register('description')} />
              {errors.description && <p className="text-xs text-destructive">{errors.description.message}</p>}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Scheduled Date *</Label>
                <Input type="date" {...register('scheduledDate')} />
              </div>
              <div className="space-y-1">
                <Label>Estimated Cost (RWF)</Label>
                <Input type="number" {...register('cost')} />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={isSubmitting || mutation.isPending}>
                {mutation.isPending ? 'Saving...' : 'Schedule'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
