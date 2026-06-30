import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/axios';
import { DataTable, type Column } from '@/components/shared/DataTable';
import { PageHeader } from '@/components/shared/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, Pencil, Trash2, ToggleLeft, ToggleRight } from 'lucide-react';
import { formatDate } from '@/lib/utils';
import { useAuth } from '@/features/auth/AuthContext';
import { toast } from 'sonner';

interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

const ROLES = ['ADMIN', 'MANAGER', 'ACCOUNTANT', 'HR_OFFICER', 'PRODUCTION_SUPERVISOR', 'SALES_OFFICER'] as const;

const createSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  role: z.enum(ROLES),
});

const editSchema = z.object({
  email: z.string().email().optional(),
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  role: z.enum(ROLES).optional(),
});

type CreateValues = z.infer<typeof createSchema>;
type EditValues = z.infer<typeof editSchema>;

export default function UsersPage() {
  useEffect(() => {
    document.title = 'Users | OMNES ERP';
    return () => { document.title = 'OMNES ERP'; };
  }, []);
  const qc = useQueryClient();
  const { user: currentUser } = useAuth();
  const isAdmin = currentUser?.role === 'ADMIN';

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editUser, setEditUser] = useState<User | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['users', page, search],
    queryFn: async () => {
      const res = await api.get('/users', { params: { page, pageSize: 20, search } });
      return res.data as { data: User[]; total: number; page: number; pageSize: number };
    },
    enabled: isAdmin,
  });

  const createForm = useForm<CreateValues>({
    resolver: zodResolver(createSchema),
    defaultValues: { role: 'SALES_OFFICER' },
  });

  const editForm = useForm<EditValues>({ resolver: zodResolver(editSchema) });

  const createMutation = useMutation({
    mutationFn: (v: CreateValues) => api.post('/users', v),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['users'] });
      setCreateOpen(false);
      createForm.reset({ role: 'SALES_OFFICER' });
      toast.success('User created.');
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Something went wrong. Please try again.';
      toast.error(msg);
    },
  });

  const editMutation = useMutation({
    mutationFn: ({ id, values }: { id: string; values: EditValues }) => api.put(`/users/${id}`, values),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['users'] });
      setEditUser(null);
      toast.success('User updated.');
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Something went wrong. Please try again.';
      toast.error(msg);
    },
  });

  const toggleMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/users/${id}/toggle-status`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['users'] });
      toast.success('User status updated.');
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Something went wrong. Please try again.';
      toast.error(msg);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/users/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['users'] });
      setDeleteId(null);
      toast.success('User deleted.');
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Something went wrong. Please try again.';
      toast.error(msg);
    },
  });

  const openEdit = (u: User) => {
    setEditUser(u);
    editForm.reset({ email: u.email, firstName: u.firstName, lastName: u.lastName, role: u.role as typeof ROLES[number] });
  };

  const columns: Column<User>[] = [
    { key: 'name', header: 'Name', render: (r) => `${r.firstName} ${r.lastName}` },
    { key: 'email', header: 'Email' },
    { key: 'role', header: 'Role', render: (r) => <Badge variant="outline">{r.role.replace('_', ' ')}</Badge> },
    { key: 'isActive', header: 'Status', render: (r) => <Badge variant={r.isActive ? 'success' : 'destructive'}>{r.isActive ? 'Active' : 'Inactive'}</Badge> },
    { key: 'lastLoginAt', header: 'Last Login', render: (r) => r.lastLoginAt ? formatDate(r.lastLoginAt) : '-' },
    { key: 'createdAt', header: 'Created', render: (r) => formatDate(r.createdAt) },
  ];

  if (!isAdmin) {
    return (
      <div className="space-y-6">
        <PageHeader title="User Management" breadcrumbs={[{ label: 'Settings' }, { label: 'Users' }]} />
        <div className="rounded-lg border bg-white p-8 text-center text-brand-muted">Only administrators can manage users.</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="User Management"
        breadcrumbs={[{ label: 'Settings' }, { label: 'Users' }]}
        actions={<Button onClick={() => { createForm.reset({ role: 'SALES_OFFICER' }); setCreateOpen(true); }}><Plus className="h-4 w-4" /> Add User</Button>}
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
        searchPlaceholder="Search users..."
        actions={(row) => (
          <div className="flex items-center justify-end gap-1">
            <Button variant="ghost" size="icon" onClick={() => toggleMutation.mutate(row.id)} title={row.isActive ? 'Deactivate' : 'Activate'}>
              {row.isActive ? <ToggleRight className="h-4 w-4 text-success" /> : <ToggleLeft className="h-4 w-4 text-brand-muted" />}
            </Button>
            <Button variant="ghost" size="icon" onClick={() => openEdit(row)}><Pencil className="h-4 w-4" /></Button>
            {currentUser?.id !== row.id && (
              <Button variant="ghost" size="icon" className="text-destructive" onClick={() => setDeleteId(row.id)}><Trash2 className="h-4 w-4" /></Button>
            )}
          </div>
        )}
      />

      <Dialog open={createOpen} onOpenChange={(o) => { setCreateOpen(o); if (!o) createForm.reset({ role: 'SALES_OFFICER' }); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add User</DialogTitle></DialogHeader>
          <form onSubmit={createForm.handleSubmit((v) => createMutation.mutate(v))} className="space-y-4 mt-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>First Name *</Label>
                <Input {...createForm.register('firstName')} />
                {createForm.formState.errors.firstName && <p className="text-xs text-destructive">Required</p>}
              </div>
              <div className="space-y-1">
                <Label>Last Name *</Label>
                <Input {...createForm.register('lastName')} />
                {createForm.formState.errors.lastName && <p className="text-xs text-destructive">Required</p>}
              </div>
            </div>
            <div className="space-y-1">
              <Label>Email *</Label>
              <Input type="email" {...createForm.register('email')} />
              {createForm.formState.errors.email && <p className="text-xs text-destructive">{createForm.formState.errors.email.message}</p>}
            </div>
            <div className="space-y-1">
              <Label>Password * (min 8 chars)</Label>
              <Input type="password" {...createForm.register('password')} />
              {createForm.formState.errors.password && <p className="text-xs text-destructive">{createForm.formState.errors.password.message}</p>}
            </div>
            <div className="space-y-1">
              <Label>Role *</Label>
              <Controller name="role" control={createForm.control} render={({ field }) => (
                <Select onValueChange={field.onChange} value={field.value}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{ROLES.map((r) => <SelectItem key={r} value={r}>{r.replace('_', ' ')}</SelectItem>)}</SelectContent>
                </Select>
              )} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={createForm.formState.isSubmitting || createMutation.isPending}>
                {createMutation.isPending ? 'Creating...' : 'Create'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editUser} onOpenChange={(o) => !o && setEditUser(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit User: {editUser?.firstName} {editUser?.lastName}</DialogTitle></DialogHeader>
          <form onSubmit={editForm.handleSubmit((v) => editUser && editMutation.mutate({ id: editUser.id, values: v }))} className="space-y-4 mt-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>First Name</Label>
                <Input {...editForm.register('firstName')} />
              </div>
              <div className="space-y-1">
                <Label>Last Name</Label>
                <Input {...editForm.register('lastName')} />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Email</Label>
              <Input type="email" {...editForm.register('email')} />
              {editForm.formState.errors.email && <p className="text-xs text-destructive">{editForm.formState.errors.email.message}</p>}
            </div>
            <div className="space-y-1">
              <Label>Role</Label>
              <Controller name="role" control={editForm.control} render={({ field }) => (
                <Select onValueChange={field.onChange} value={field.value}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{ROLES.map((r) => <SelectItem key={r} value={r}>{r.replace('_', ' ')}</SelectItem>)}</SelectContent>
                </Select>
              )} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditUser(null)}>Cancel</Button>
              <Button type="submit" disabled={editForm.formState.isSubmitting || editMutation.isPending}>
                {editMutation.isPending ? 'Saving...' : 'Save'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={(o) => !o && setDeleteId(null)}
        title="Delete User"
        description="Delete this user account? They will lose access immediately."
        confirmLabel="Delete"
        onConfirm={() => deleteId && deleteMutation.mutate(deleteId)}
        isLoading={deleteMutation.isPending}
      />
    </div>
  );
}
