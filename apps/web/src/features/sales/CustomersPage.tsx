import { useState, useEffect } from 'react';
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
import { toast } from 'sonner';

interface Customer {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  address: string | null;
  tinNumber: string | null;
}

const schema = z.object({
  name: z.string().min(1),
  phone: z.string().min(1),
  email: z.string().email().optional().or(z.literal('')),
  address: z.string().optional(),
  tinNumber: z.string().optional(),
});
type FormValues = z.infer<typeof schema>;

export default function CustomersPage() {
  useEffect(() => {
    document.title = 'Customers | OMNES ERP';
    return () => { document.title = 'OMNES ERP'; };
  }, []);
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['customers', page, search],
    queryFn: async () => {
      const res = await api.get('/customers', { params: { page, pageSize: 20, search } });
      return res.data as { data: Customer[]; total: number; page: number; pageSize: number };
    },
  });

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema),
  });

  const mutation = useMutation({
    mutationFn: (values: FormValues) =>
      editingId ? api.put(`/customers/${editingId}`, values) : api.post('/customers', values),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['customers'] });
      setDialogOpen(false);
      reset();
      setEditingId(null);
      toast.success(editingId ? 'Customer updated.' : 'Customer created.');
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Something went wrong. Please try again.';
      toast.error(msg);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/customers/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['customers'] });
      setDeleteId(null);
      toast.success('Customer deleted.');
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Something went wrong. Please try again.';
      toast.error(msg);
    },
  });

  const openEdit = (row: Customer) => {
    setEditingId(row.id);
    reset({ name: row.name, phone: row.phone, email: row.email ?? '', address: row.address ?? '', tinNumber: row.tinNumber ?? '' });
    setDialogOpen(true);
  };

  const columns: Column<Customer>[] = [
    { key: 'name', header: 'Customer' },
    { key: 'phone', header: 'Phone' },
    { key: 'email', header: 'Email', render: (r) => r.email ?? '-' },
    { key: 'tinNumber', header: 'TIN', render: (r) => r.tinNumber ?? '-' },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Customers"
        breadcrumbs={[{ label: 'Sales' }, { label: 'Customers' }]}
        actions={
          <Button onClick={() => { reset(); setEditingId(null); setDialogOpen(true); }}>
            <Plus className="h-4 w-4" /> Add Customer
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
        searchPlaceholder="Search customers..."
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
            <DialogTitle>{editingId ? 'Edit Customer' : 'Add Customer'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit((v) => mutation.mutate(v))} className="space-y-4 mt-2">
            <div className="space-y-1">
              <Label>Name *</Label>
              <Input {...register('name')} />
              {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
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
            <div className="space-y-1">
              <Label>TIN Number</Label>
              <Input {...register('tinNumber')} />
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
        title="Delete Customer"
        description="Delete this customer? Associated sales records will remain."
        confirmLabel="Delete"
        onConfirm={() => deleteId && deleteMutation.mutate(deleteId)}
        isLoading={deleteMutation.isPending}
      />
    </div>
  );
}
