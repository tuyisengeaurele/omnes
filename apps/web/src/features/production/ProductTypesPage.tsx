import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/axios';
import { DataTable, type Column } from '@/components/shared/DataTable';
import { PageHeader } from '@/components/shared/PageHeader';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, Edit, Trash2 } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { toast } from 'sonner';

interface ProductType {
  id: string;
  name: string;
  unit: string;
  standardPrice: string;
  description: string | null;
}

const schema = z.object({
  name: z.string().min(1),
  unit: z.string().min(1),
  standardPrice: z.coerce.number().nonnegative(),
  description: z.string().optional(),
});
type FormValues = z.infer<typeof schema>;

export default function ProductTypesPage() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['product-types', page, search],
    queryFn: async () => {
      const res = await api.get('/product-types', { params: { page, pageSize: 20, search } });
      return res.data as { data: ProductType[]; total: number; page: number; pageSize: number };
    },
  });

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema),
  });

  const mutation = useMutation({
    mutationFn: (values: FormValues) =>
      editingId ? api.put(`/product-types/${editingId}`, values) : api.post('/product-types', values),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['product-types'] });
      setDialogOpen(false);
      reset();
      setEditingId(null);
      toast.success(editingId ? 'Product type updated.' : 'Product type created.');
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Something went wrong. Please try again.';
      toast.error(msg);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/product-types/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['product-types'] });
      setDeleteId(null);
      toast.success('Product type deleted.');
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Something went wrong. Please try again.';
      toast.error(msg);
    },
  });

  const openEdit = (row: ProductType) => {
    setEditingId(row.id);
    reset({ name: row.name, unit: row.unit, standardPrice: Number(row.standardPrice), description: row.description ?? '' });
    setDialogOpen(true);
  };

  const columns: Column<ProductType>[] = [
    { key: 'name', header: 'Name' },
    { key: 'unit', header: 'Unit' },
    { key: 'standardPrice', header: 'Standard Price', render: (r) => formatCurrency(Number(r.standardPrice)) },
    { key: 'description', header: 'Description', render: (r) => r.description ?? '-' },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Product Types"
        breadcrumbs={[{ label: 'Production' }, { label: 'Product Types' }]}
        actions={
          <Button onClick={() => { reset(); setEditingId(null); setDialogOpen(true); }}>
            <Plus className="h-4 w-4" /> Add Product Type
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
        searchPlaceholder="Search product types..."
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
            <DialogTitle>{editingId ? 'Edit Product Type' : 'Add Product Type'}</DialogTitle>
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
                <Input {...register('unit')} placeholder="e.g. pieces, kg" />
                {errors.unit && <p className="text-xs text-destructive">{errors.unit.message}</p>}
              </div>
              <div className="space-y-1">
                <Label>Standard Price (RWF)</Label>
                <Input type="number" {...register('standardPrice')} />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Description</Label>
              <Input {...register('description')} />
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
        title="Delete Product Type"
        description="Delete this product type? It must not be referenced by any active batches."
        confirmLabel="Delete"
        onConfirm={() => deleteId && deleteMutation.mutate(deleteId)}
        isLoading={deleteMutation.isPending}
      />
    </div>
  );
}
