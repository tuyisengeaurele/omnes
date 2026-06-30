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
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, Edit, Trash2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';

interface RawMaterial {
  id: string;
  name: string;
  unit: string;
  currentStock: number;
  reorderLevel: number;
  unitCost: string;
}

const schema = z.object({
  name: z.string().min(1),
  unit: z.string().min(1),
  reorderLevel: z.coerce.number().nonnegative(),
  unitCost: z.coerce.number().nonnegative(),
});
type FormValues = z.infer<typeof schema>;

export default function MaterialsPage() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [lowStockOnly, setLowStockOnly] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['raw-materials', page, search, lowStockOnly],
    queryFn: async () => {
      const url = lowStockOnly ? '/raw-materials/low-stock' : '/raw-materials';
      const res = await api.get(url, { params: { page, pageSize: 20, search } });
      return res.data as { data: RawMaterial[]; total: number; page: number; pageSize: number };
    },
  });

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema),
  });

  const mutation = useMutation({
    mutationFn: (values: FormValues) =>
      editingId ? api.put(`/raw-materials/${editingId}`, values) : api.post('/raw-materials', values),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['raw-materials'] });
      setDialogOpen(false);
      reset();
      setEditingId(null);
      toast.success(editingId ? 'Material updated.' : 'Material created.');
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Something went wrong. Please try again.';
      toast.error(msg);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/raw-materials/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['raw-materials'] });
      setDeleteId(null);
      toast.success('Material deleted.');
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Something went wrong. Please try again.';
      toast.error(msg);
    },
  });

  const openEdit = (row: RawMaterial) => {
    setEditingId(row.id);
    reset({ name: row.name, unit: row.unit, reorderLevel: row.reorderLevel, unitCost: Number(row.unitCost) });
    setDialogOpen(true);
  };

  const columns: Column<RawMaterial>[] = [
    { key: 'name', header: 'Material' },
    { key: 'currentStock', header: 'Current Stock', render: (r) => (
      <span className={r.currentStock <= r.reorderLevel ? 'text-destructive font-semibold flex items-center gap-1' : ''}>
        {r.currentStock <= r.reorderLevel && <AlertTriangle className="h-3.5 w-3.5" />}
        {r.currentStock.toLocaleString()} {r.unit}
      </span>
    ) },
    { key: 'reorderLevel', header: 'Reorder Level', render: (r) => `${r.reorderLevel.toLocaleString()} ${r.unit}` },
    { key: 'unitCost', header: 'Unit Cost', render: (r) => `RWF ${Number(r.unitCost).toLocaleString()}` },
    { key: 'status', header: 'Status', render: (r) => (
      <Badge variant={r.currentStock <= r.reorderLevel ? 'destructive' : 'success'}>
        {r.currentStock <= r.reorderLevel ? 'Low Stock' : 'OK'}
      </Badge>
    ) },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Raw Materials"
        breadcrumbs={[{ label: 'Inventory' }, { label: 'Raw Materials' }]}
        actions={
          <div className="flex gap-2">
            <Button variant={lowStockOnly ? 'default' : 'outline'} onClick={() => setLowStockOnly((v) => !v)}>
              <AlertTriangle className="h-4 w-4" /> Low Stock
            </Button>
            <Button onClick={() => { reset(); setEditingId(null); setDialogOpen(true); }}>
              <Plus className="h-4 w-4" /> Add Material
            </Button>
          </div>
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
        searchPlaceholder="Search materials..."
        actions={(row) => (
          <div className="flex items-center justify-end gap-1">
            <Button variant="ghost" size="icon" onClick={() => openEdit(row)}>
              <Edit className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="text-destructive" onClick={() => setDeleteId(row.id)}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        )}
      />

      <Dialog open={dialogOpen} onOpenChange={(o) => { setDialogOpen(o); if (!o) { reset(); setEditingId(null); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? 'Edit Material' : 'Add Material'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit((v) => mutation.mutate(v))} className="space-y-4 mt-2">
            <div className="space-y-1">
              <Label>Name *</Label>
              <Input {...register('name')} />
              {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Unit *</Label>
                <Input {...register('unit')} placeholder="e.g. kg, tonnes" />
                {errors.unit && <p className="text-xs text-destructive">{errors.unit.message}</p>}
              </div>
              <div className="space-y-1">
                <Label>Reorder Level *</Label>
                <Input type="number" {...register('reorderLevel')} />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Unit Cost (RWF) *</Label>
              <Input type="number" {...register('unitCost')} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={isSubmitting || mutation.isPending}>
                {mutation.isPending ? 'Saving...' : editingId ? 'Update' : 'Create'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={(o) => !o && setDeleteId(null)}
        title="Delete Material"
        description="Delete this raw material? Stock history will also be removed."
        confirmLabel="Delete"
        onConfirm={() => deleteId && deleteMutation.mutate(deleteId)}
        isLoading={deleteMutation.isPending}
      />
    </div>
  );
}
