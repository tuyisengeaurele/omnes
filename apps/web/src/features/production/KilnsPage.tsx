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
import { Plus, Edit, Trash2 } from 'lucide-react';

interface Kiln {
  id: string;
  name: string;
  capacity: number;
  status: string;
  location: string | null;
}

const schema = z.object({
  name: z.string().min(1),
  capacity: z.coerce.number().positive(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'MAINTENANCE']),
  location: z.string().optional(),
});
type FormValues = z.infer<typeof schema>;

const STATUS_COLORS: Record<string, 'success' | 'secondary' | 'warning'> = {
  ACTIVE: 'success',
  INACTIVE: 'secondary',
  MAINTENANCE: 'warning',
};

export default function KilnsPage() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['kilns', page, search],
    queryFn: async () => {
      const res = await api.get('/kilns', { params: { page, pageSize: 20, search } });
      return res.data as { data: Kiln[]; total: number; page: number; pageSize: number };
    },
  });

  const { register, handleSubmit, control, reset, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { status: 'ACTIVE' },
  });

  const mutation = useMutation({
    mutationFn: (values: FormValues) =>
      editingId ? api.put(`/kilns/${editingId}`, values) : api.post('/kilns', values),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['kilns'] });
      setDialogOpen(false);
      reset();
      setEditingId(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/kilns/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['kilns'] });
      setDeleteId(null);
    },
  });

  const openEdit = (row: Kiln) => {
    setEditingId(row.id);
    reset({ name: row.name, capacity: row.capacity, status: row.status as FormValues['status'], location: row.location ?? '' });
    setDialogOpen(true);
  };

  const columns: Column<Kiln>[] = [
    { key: 'name', header: 'Kiln Name' },
    { key: 'capacity', header: 'Capacity', render: (r) => r.capacity.toLocaleString() },
    { key: 'location', header: 'Location', render: (r) => r.location ?? '—' },
    { key: 'status', header: 'Status', render: (r) => <Badge variant={STATUS_COLORS[r.status] ?? 'outline'}>{r.status}</Badge> },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Kilns"
        breadcrumbs={[{ label: 'Production' }, { label: 'Kilns' }]}
        actions={
          <Button onClick={() => { reset({ status: 'ACTIVE' }); setEditingId(null); setDialogOpen(true); }}>
            <Plus className="h-4 w-4" /> Add Kiln
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
        searchPlaceholder="Search kilns..."
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
            <DialogTitle>{editingId ? 'Edit Kiln' : 'Add Kiln'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit((v) => mutation.mutate(v))} className="space-y-4 mt-2">
            <div className="space-y-1">
              <Label>Name *</Label>
              <Input {...register('name')} />
              {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Capacity *</Label>
                <Input type="number" {...register('capacity')} />
                {errors.capacity && <p className="text-xs text-destructive">{errors.capacity.message}</p>}
              </div>
              <div className="space-y-1">
                <Label>Status *</Label>
                <Controller name="status" control={control} render={({ field }) => (
                  <Select onValueChange={field.onChange} value={field.value}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {['ACTIVE', 'INACTIVE', 'MAINTENANCE'].map((s) => (
                        <SelectItem key={s} value={s}>{s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )} />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Location</Label>
              <Input {...register('location')} />
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
        title="Delete Kiln"
        description="This will permanently delete this kiln record."
        confirmLabel="Delete"
        onConfirm={() => deleteId && deleteMutation.mutate(deleteId)}
        isLoading={deleteMutation.isPending}
      />
    </div>
  );
}
