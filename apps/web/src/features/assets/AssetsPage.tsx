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
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, Archive } from 'lucide-react';
import { formatCurrency, formatDate } from '@/lib/utils';
import { toast } from 'sonner';

interface FixedAsset {
  id: string;
  name: string;
  category: string;
  purchaseDate: string;
  purchaseValue: string;
  currentValue: string;
  status: string;
}

const schema = z.object({
  name: z.string().min(1),
  category: z.string().min(1),
  purchaseDate: z.string().min(1),
  purchaseValue: z.coerce.number().positive(),
});
type FormValues = z.infer<typeof schema>;

const STATUS_COLORS: Record<string, 'success' | 'warning' | 'secondary' | 'destructive'> = {
  ACTIVE: 'success',
  UNDER_MAINTENANCE: 'warning',
  IDLE: 'secondary',
  DISPOSED: 'destructive',
};

export default function AssetsPage() {
  useEffect(() => {
    document.title = 'Fixed Assets | OMNES ERP';
    return () => { document.title = 'OMNES ERP'; };
  }, []);
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [disposeId, setDisposeId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['fixed-assets', page, search],
    queryFn: async () => {
      const res = await api.get('/fixed-assets', { params: { page, pageSize: 20, search } });
      return res.data as { data: FixedAsset[]; total: number; page: number; pageSize: number };
    },
  });

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { purchaseDate: new Date().toISOString().split('T')[0] },
  });

  const mutation = useMutation({
    mutationFn: (values: FormValues) => api.post('/fixed-assets', values),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['fixed-assets'] });
      setDialogOpen(false);
      reset({ purchaseDate: new Date().toISOString().split('T')[0] });
      toast.success('Asset created.');
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Something went wrong. Please try again.';
      toast.error(msg);
    },
  });

  const disposeMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/fixed-assets/${id}/dispose`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['fixed-assets'] });
      setDisposeId(null);
      toast.success('Asset disposed.');
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Something went wrong. Please try again.';
      toast.error(msg);
    },
  });

  const columns: Column<FixedAsset>[] = [
    { key: 'name', header: 'Asset' },
    { key: 'category', header: 'Category', render: (r) => <Badge variant="outline">{r.category}</Badge> },
    { key: 'purchaseDate', header: 'Purchased', render: (r) => formatDate(r.purchaseDate) },
    { key: 'purchaseValue', header: 'Purchase Value', render: (r) => formatCurrency(Number(r.purchaseValue)) },
    { key: 'currentValue', header: 'Current Value', render: (r) => formatCurrency(Number(r.currentValue)) },
    { key: 'status', header: 'Status', render: (r) => <Badge variant={STATUS_COLORS[r.status] ?? 'outline'}>{r.status.replace('_', ' ')}</Badge> },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Fixed Assets"
        breadcrumbs={[{ label: 'Assets' }, { label: 'Fixed Assets' }]}
        actions={
          <Button onClick={() => { reset({ purchaseDate: new Date().toISOString().split('T')[0] }); setDialogOpen(true); }}>
            <Plus className="h-4 w-4" /> Add Asset
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
        searchPlaceholder="Search assets..."
        actions={(row) =>
          row.status !== 'DISPOSED' ? (
            <div className="flex items-center justify-end">
              <Button variant="ghost" size="icon" className="text-destructive" onClick={() => setDisposeId(row.id)}>
                <Archive className="h-4 w-4" />
              </Button>
            </div>
          ) : null
        }
      />

      <Dialog open={dialogOpen} onOpenChange={(o) => { setDialogOpen(o); if (!o) reset({ purchaseDate: new Date().toISOString().split('T')[0] }); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Fixed Asset</DialogTitle></DialogHeader>
          <form onSubmit={handleSubmit((v) => mutation.mutate(v))} className="space-y-4 mt-2">
            <div className="space-y-1">
              <Label>Name *</Label>
              <Input {...register('name')} />
              {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
            </div>
            <div className="space-y-1">
              <Label>Category *</Label>
              <Input {...register('category')} placeholder="e.g. Vehicle, Machinery" />
              {errors.category && <p className="text-xs text-destructive">{errors.category.message}</p>}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Purchase Date *</Label>
                <Input type="date" {...register('purchaseDate')} />
              </div>
              <div className="space-y-1">
                <Label>Purchase Value (RWF) *</Label>
                <Input type="number" {...register('purchaseValue')} />
                {errors.purchaseValue && <p className="text-xs text-destructive">{errors.purchaseValue.message}</p>}
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={isSubmitting || mutation.isPending}>
                {mutation.isPending ? 'Saving...' : 'Create'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!disposeId}
        onOpenChange={(o) => !o && setDisposeId(null)}
        title="Dispose Asset"
        description="Mark this asset as disposed? This status cannot be reversed."
        confirmLabel="Dispose"
        onConfirm={() => disposeId && disposeMutation.mutate(disposeId)}
        isLoading={disposeMutation.isPending}
      />
    </div>
  );
}
