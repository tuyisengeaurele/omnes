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
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { formatDateTime } from '@/lib/utils';

interface StockMovement {
  id: string;
  type: string;
  quantity: number;
  notes: string | null;
  createdAt: string;
  rawMaterial: { name: string; unit: string };
}

const schema = z.object({
  rawMaterialId: z.string().min(1),
  type: z.enum(['IN', 'OUT', 'ADJUSTMENT']),
  quantity: z.coerce.number().positive(),
  notes: z.string().optional(),
});
type FormValues = z.infer<typeof schema>;

const TYPE_COLORS: Record<string, 'success' | 'destructive' | 'warning'> = {
  IN: 'success',
  OUT: 'destructive',
  ADJUSTMENT: 'warning',
};

export default function MovementsPage() {
  useEffect(() => {
    document.title = 'Inventory Movements | OMNES ERP';
    return () => { document.title = 'OMNES ERP'; };
  }, []);
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['stock-movements', page, search],
    queryFn: async () => {
      const res = await api.get('/stock-movements', { params: { page, pageSize: 20, search } });
      return res.data as { data: StockMovement[]; total: number; page: number; pageSize: number };
    },
  });

  const { data: materials } = useQuery({
    queryKey: ['raw-materials-list'],
    queryFn: async () => {
      const res = await api.get('/raw-materials', { params: { pageSize: 100 } });
      return res.data.data as Array<{ id: string; name: string; unit: string }>;
    },
  });

  const { register, handleSubmit, control, reset, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { type: 'IN' },
  });

  const mutation = useMutation({
    mutationFn: (values: FormValues) => api.post('/stock-movements', values),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['stock-movements'] });
      void qc.invalidateQueries({ queryKey: ['raw-materials'] });
      setDialogOpen(false);
      reset({ type: 'IN' });
      toast.success('Movement recorded.');
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Something went wrong. Please try again.';
      toast.error(msg);
    },
  });

  const columns: Column<StockMovement>[] = [
    { key: 'rawMaterial', header: 'Material', render: (r) => r.rawMaterial.name },
    { key: 'type', header: 'Type', render: (r) => <Badge variant={TYPE_COLORS[r.type] ?? 'outline'}>{r.type}</Badge> },
    { key: 'quantity', header: 'Quantity', render: (r) => `${r.quantity.toLocaleString()} ${r.rawMaterial.unit}` },
    { key: 'notes', header: 'Notes', render: (r) => r.notes ?? '-' },
    { key: 'createdAt', header: 'Date', render: (r) => formatDateTime(r.createdAt) },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Stock Movements"
        breadcrumbs={[{ label: 'Inventory' }, { label: 'Movements' }]}
        actions={
          <Button onClick={() => { reset({ type: 'IN' }); setDialogOpen(true); }}>
            <Plus className="h-4 w-4" /> Record Movement
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
        searchPlaceholder="Search by material..."
      />

      <Dialog open={dialogOpen} onOpenChange={(o) => { setDialogOpen(o); if (!o) reset({ type: 'IN' }); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record Stock Movement</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit((v) => mutation.mutate(v))} className="space-y-4 mt-2">
            <div className="space-y-1">
              <Label>Raw Material *</Label>
              <Controller name="rawMaterialId" control={control} render={({ field }) => (
                <Select onValueChange={field.onChange} value={field.value}>
                  <SelectTrigger><SelectValue placeholder="Select material" /></SelectTrigger>
                  <SelectContent>{materials?.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}</SelectContent>
                </Select>
              )} />
              {errors.rawMaterialId && <p className="text-xs text-destructive">Required</p>}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Type *</Label>
                <Controller name="type" control={control} render={({ field }) => (
                  <Select onValueChange={field.onChange} value={field.value}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {['IN', 'OUT', 'ADJUSTMENT'].map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )} />
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
                {mutation.isPending ? 'Saving...' : 'Record'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
