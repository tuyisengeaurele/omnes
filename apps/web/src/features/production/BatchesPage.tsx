import { useState, useEffect } from 'react';
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
import { Plus, Eye } from 'lucide-react';
import { formatDate } from '@/lib/utils';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';

interface Batch {
  id: string;
  batchNumber: string;
  startDate: string;
  endDate: string | null;
  status: string;
  kiln: { name: string };
  productType: { name: string };
  quantity: number;
}

const schema = z.object({
  batchNumber: z.string().min(1),
  kilnId: z.string().min(1),
  productTypeId: z.string().min(1),
  startDate: z.string().min(1),
  quantity: z.coerce.number().positive(),
  notes: z.string().optional(),
});
type FormValues = z.infer<typeof schema>;

const STATUS_COLORS: Record<string, 'warning' | 'secondary' | 'success' | 'destructive'> = {
  LOADING: 'warning',
  FIRING: 'secondary',
  COOLING: 'warning',
  COMPLETED: 'success',
  FAILED: 'destructive',
};

export default function BatchesPage() {
  useEffect(() => {
    document.title = 'Production Batches | OMNES ERP';
    return () => { document.title = 'OMNES ERP'; };
  }, []);
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['batches', page, search],
    queryFn: async () => {
      const res = await api.get('/batches', { params: { page, pageSize: 20, search } });
      return res.data as { data: Batch[]; total: number; page: number; pageSize: number };
    },
  });

  const { data: kilns } = useQuery({
    queryKey: ['kilns-list'],
    queryFn: async () => {
      const res = await api.get('/kilns', { params: { pageSize: 100 } });
      return res.data.data as Array<{ id: string; name: string }>;
    },
  });

  const { data: productTypes } = useQuery({
    queryKey: ['product-types-list'],
    queryFn: async () => {
      const res = await api.get('/product-types', { params: { pageSize: 100 } });
      return res.data.data as Array<{ id: string; name: string }>;
    },
  });

  const { register, handleSubmit, control, reset, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { startDate: new Date().toISOString().split('T')[0] },
  });

  const mutation = useMutation({
    mutationFn: (values: FormValues) => api.post('/batches', values),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['batches'] });
      setDialogOpen(false);
      reset();
      toast.success('Batch created.');
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Something went wrong. Please try again.';
      toast.error(msg);
    },
  });

  const columns: Column<Batch>[] = [
    { key: 'batchNumber', header: 'Batch #', className: 'font-mono text-xs' },
    { key: 'productType', header: 'Product', render: (r) => r.productType.name },
    { key: 'kiln', header: 'Kiln', render: (r) => r.kiln.name },
    { key: 'quantity', header: 'Quantity', render: (r) => r.quantity.toLocaleString() },
    { key: 'startDate', header: 'Start', render: (r) => formatDate(r.startDate) },
    { key: 'endDate', header: 'End', render: (r) => r.endDate ? formatDate(r.endDate) : '-' },
    { key: 'status', header: 'Status', render: (r) => <Badge variant={STATUS_COLORS[r.status] ?? 'outline'}>{r.status}</Badge> },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Production Batches"
        breadcrumbs={[{ label: 'Production' }, { label: 'Batches' }]}
        actions={
          <Button onClick={() => { reset({ startDate: new Date().toISOString().split('T')[0] }); setDialogOpen(true); }}>
            <Plus className="h-4 w-4" /> New Batch
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
        searchPlaceholder="Search batches..."
        actions={(row) => (
          <div className="flex items-center justify-end">
            <Button variant="ghost" size="icon" asChild>
              <Link to={`/production/batches/${row.id}`}><Eye className="h-4 w-4" /></Link>
            </Button>
          </div>
        )}
      />

      <Dialog open={dialogOpen} onOpenChange={(o) => { setDialogOpen(o); if (!o) reset(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Production Batch</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit((v) => mutation.mutate(v))} className="space-y-4 mt-2">
            <div className="space-y-1">
              <Label>Batch Number *</Label>
              <Input {...register('batchNumber')} placeholder="e.g. B-2026-001" />
              {errors.batchNumber && <p className="text-xs text-destructive">{errors.batchNumber.message}</p>}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Kiln *</Label>
                <Controller name="kilnId" control={control} render={({ field }) => (
                  <Select onValueChange={field.onChange} value={field.value}>
                    <SelectTrigger><SelectValue placeholder="Select kiln" /></SelectTrigger>
                    <SelectContent>{kilns?.map((k) => <SelectItem key={k.id} value={k.id}>{k.name}</SelectItem>)}</SelectContent>
                  </Select>
                )} />
                {errors.kilnId && <p className="text-xs text-destructive">Required</p>}
              </div>
              <div className="space-y-1">
                <Label>Product Type *</Label>
                <Controller name="productTypeId" control={control} render={({ field }) => (
                  <Select onValueChange={field.onChange} value={field.value}>
                    <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                    <SelectContent>{productTypes?.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
                  </Select>
                )} />
                {errors.productTypeId && <p className="text-xs text-destructive">Required</p>}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Start Date *</Label>
                <Input type="date" {...register('startDate')} />
              </div>
              <div className="space-y-1">
                <Label>Quantity *</Label>
                <Input type="number" {...register('quantity')} />
                {errors.quantity && <p className="text-xs text-destructive">{errors.quantity.message}</p>}
              </div>
            </div>
            <div className="space-y-1">
              <Label>Notes</Label>
              <Input {...register('notes')} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={isSubmitting || mutation.isPending}>
                {mutation.isPending ? 'Creating...' : 'Create Batch'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
