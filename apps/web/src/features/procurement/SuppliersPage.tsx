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
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, Edit, Power } from 'lucide-react';

interface Supplier {
  id: string;
  name: string;
  contactPerson: string | null;
  phone: string;
  email: string | null;
  address: string | null;
  isActive: boolean;
}

const schema = z.object({
  name: z.string().min(1),
  contactPerson: z.string().optional(),
  phone: z.string().min(1),
  email: z.string().email().optional().or(z.literal('')),
  address: z.string().optional(),
});
type FormValues = z.infer<typeof schema>;

export default function SuppliersPage() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['suppliers', page, search],
    queryFn: async () => {
      const res = await api.get('/suppliers', { params: { page, pageSize: 20, search } });
      return res.data as { data: Supplier[]; total: number; page: number; pageSize: number };
    },
  });

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema),
  });

  const mutation = useMutation({
    mutationFn: (values: FormValues) =>
      editingId ? api.put(`/suppliers/${editingId}`, values) : api.post('/suppliers', values),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['suppliers'] });
      setDialogOpen(false);
      reset();
      setEditingId(null);
    },
  });

  const toggleMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/suppliers/${id}/toggle-status`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['suppliers'] }),
  });

  const openEdit = (row: Supplier) => {
    setEditingId(row.id);
    reset({ name: row.name, contactPerson: row.contactPerson ?? '', phone: row.phone, email: row.email ?? '', address: row.address ?? '' });
    setDialogOpen(true);
  };

  const columns: Column<Supplier>[] = [
    { key: 'name', header: 'Supplier' },
    { key: 'contactPerson', header: 'Contact', render: (r) => r.contactPerson ?? '—' },
    { key: 'phone', header: 'Phone' },
    { key: 'email', header: 'Email', render: (r) => r.email ?? '—' },
    { key: 'isActive', header: 'Status', render: (r) => <Badge variant={r.isActive ? 'success' : 'secondary'}>{r.isActive ? 'Active' : 'Inactive'}</Badge> },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Suppliers"
        breadcrumbs={[{ label: 'Procurement' }, { label: 'Suppliers' }]}
        actions={
          <Button onClick={() => { reset(); setEditingId(null); setDialogOpen(true); }}>
            <Plus className="h-4 w-4" /> Add Supplier
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
        searchPlaceholder="Search suppliers..."
        actions={(row) => (
          <div className="flex items-center justify-end gap-1">
            <Button variant="ghost" size="icon" onClick={() => openEdit(row)}>
              <Edit className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={() => toggleMutation.mutate(row.id)}>
              <Power className="h-4 w-4" />
            </Button>
          </div>
        )}
      />

      <Dialog open={dialogOpen} onOpenChange={(o) => { setDialogOpen(o); if (!o) { reset(); setEditingId(null); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? 'Edit Supplier' : 'Add Supplier'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit((v) => mutation.mutate(v))} className="space-y-4 mt-2">
            <div className="space-y-1">
              <Label>Name *</Label>
              <Input {...register('name')} />
              {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
            </div>
            <div className="space-y-1">
              <Label>Contact Person</Label>
              <Input {...register('contactPerson')} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Phone *</Label>
                <Input {...register('phone')} />
                {errors.phone && <p className="text-xs text-destructive">{errors.phone.message}</p>}
              </div>
              <div className="space-y-1">
                <Label>Email</Label>
                <Input type="email" {...register('email')} />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Address</Label>
              <Input {...register('address')} />
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
    </div>
  );
}
