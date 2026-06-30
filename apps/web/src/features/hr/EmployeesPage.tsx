import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/axios';
import { DataTable, type Column } from '@/components/shared/DataTable';
import { PageHeader } from '@/components/shared/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, Edit, Trash2, Eye } from 'lucide-react';
import { formatCurrency, formatDate } from '@/lib/utils';
import { Link } from 'react-router-dom';
import type { EmployeeStatus } from '@/types';

interface Employee {
  id: string;
  employeeNumber: string;
  firstName: string;
  lastName: string;
  position: string;
  contractType: string;
  status: EmployeeStatus;
  salary: string;
  startDate: string;
  department: { name: string };
}

const STATUS_COLORS: Record<EmployeeStatus, 'success' | 'warning' | 'destructive' | 'secondary'> = {
  ACTIVE: 'success',
  ON_LEAVE: 'warning',
  SUSPENDED: 'destructive',
  TERMINATED: 'secondary',
};

const formSchema = z.object({
  employeeNumber: z.string().min(1),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  gender: z.enum(['MALE', 'FEMALE']),
  dateOfBirth: z.string().min(1),
  nationalId: z.string().min(1),
  phone: z.string().min(1),
  email: z.string().email().optional().or(z.literal('')),
  address: z.string().min(1),
  departmentId: z.string().min(1),
  position: z.string().min(1),
  contractType: z.enum(['PERMANENT', 'CONTRACT', 'CASUAL', 'INTERN']),
  startDate: z.string().min(1),
  bankName: z.string().min(1),
  bankAccountNumber: z.string().min(1),
  salary: z.coerce.number().positive(),
});

type FormValues = z.infer<typeof formSchema>;

export default function EmployeesPage() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['employees', page, search],
    queryFn: async () => {
      const res = await api.get('/employees', { params: { page, pageSize: 20, search } });
      return res.data as { data: Employee[]; total: number; page: number; pageSize: number };
    },
  });

  const { data: depts } = useQuery({
    queryKey: ['departments'],
    queryFn: async () => {
      const res = await api.get('/departments', { params: { pageSize: 100 } });
      return res.data.data as Array<{ id: string; name: string }>;
    },
  });

  const { register, handleSubmit, control, reset, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
  });

  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      if (editingId) {
        return api.put(`/employees/${editingId}`, values);
      }
      return api.post('/employees', values);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['employees'] });
      setDialogOpen(false);
      reset();
      setEditingId(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/employees/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['employees'] });
      setDeleteId(null);
    },
  });

  const columns: Column<Employee>[] = [
    { key: 'employeeNumber', header: 'Emp #', className: 'font-mono text-xs w-24' },
    { key: 'name', header: 'Name', render: (r) => `${r.firstName} ${r.lastName}` },
    { key: 'department', header: 'Department', render: (r) => r.department.name },
    { key: 'position', header: 'Position' },
    { key: 'contractType', header: 'Contract', render: (r) => <Badge variant="outline">{r.contractType}</Badge> },
    { key: 'salary', header: 'Salary', render: (r) => formatCurrency(Number(r.salary)) },
    { key: 'startDate', header: 'Start Date', render: (r) => formatDate(r.startDate) },
    { key: 'status', header: 'Status', render: (r) => <Badge variant={STATUS_COLORS[r.status]}>{r.status}</Badge> },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Employees"
        breadcrumbs={[{ label: 'HR' }, { label: 'Employees' }]}
        actions={
          <Button onClick={() => { reset(); setEditingId(null); setDialogOpen(true); }}>
            <Plus className="h-4 w-4" /> Add Employee
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
        searchPlaceholder="Search employees..."
        actions={(row) => (
          <div className="flex items-center justify-end gap-1">
            <Button variant="ghost" size="icon" asChild>
              <Link to={`/hr/employees/${row.id}`}><Eye className="h-4 w-4" /></Link>
            </Button>
            <Button variant="ghost" size="icon" onClick={() => { setEditingId(row.id); setDialogOpen(true); }}>
              <Edit className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="text-destructive" onClick={() => setDeleteId(row.id)}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        )}
      />

      <Dialog open={dialogOpen} onOpenChange={(o) => { setDialogOpen(o); if (!o) { reset(); setEditingId(null); } }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? 'Edit Employee' : 'Add Employee'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit((v) => mutation.mutate(v))} className="grid grid-cols-2 gap-4 mt-2">
            <div className="space-y-1"><Label>Employee Number *</Label><Input {...register('employeeNumber')} />{errors.employeeNumber && <p className="text-xs text-destructive">{errors.employeeNumber.message}</p>}</div>
            <div className="space-y-1"><Label>Position *</Label><Input {...register('position')} />{errors.position && <p className="text-xs text-destructive">{errors.position.message}</p>}</div>
            <div className="space-y-1"><Label>First Name *</Label><Input {...register('firstName')} />{errors.firstName && <p className="text-xs text-destructive">{errors.firstName.message}</p>}</div>
            <div className="space-y-1"><Label>Last Name *</Label><Input {...register('lastName')} />{errors.lastName && <p className="text-xs text-destructive">{errors.lastName.message}</p>}</div>
            <div className="space-y-1">
              <Label>Gender *</Label>
              <Controller name="gender" control={control} render={({ field }) => (
                <Select onValueChange={field.onChange} value={field.value}>
                  <SelectTrigger><SelectValue placeholder="Select gender" /></SelectTrigger>
                  <SelectContent><SelectItem value="MALE">Male</SelectItem><SelectItem value="FEMALE">Female</SelectItem></SelectContent>
                </Select>
              )} />
            </div>
            <div className="space-y-1"><Label>Date of Birth *</Label><Input type="date" {...register('dateOfBirth')} /></div>
            <div className="space-y-1"><Label>National ID *</Label><Input {...register('nationalId')} /></div>
            <div className="space-y-1"><Label>Phone *</Label><Input {...register('phone')} /></div>
            <div className="space-y-1 col-span-2"><Label>Email</Label><Input type="email" {...register('email')} /></div>
            <div className="space-y-1 col-span-2"><Label>Address *</Label><Input {...register('address')} /></div>
            <div className="space-y-1">
              <Label>Department *</Label>
              <Controller name="departmentId" control={control} render={({ field }) => (
                <Select onValueChange={field.onChange} value={field.value}>
                  <SelectTrigger><SelectValue placeholder="Select department" /></SelectTrigger>
                  <SelectContent>{depts?.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent>
                </Select>
              )} />
            </div>
            <div className="space-y-1">
              <Label>Contract Type *</Label>
              <Controller name="contractType" control={control} render={({ field }) => (
                <Select onValueChange={field.onChange} value={field.value}>
                  <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                  <SelectContent>
                    {['PERMANENT', 'CONTRACT', 'CASUAL', 'INTERN'].map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              )} />
            </div>
            <div className="space-y-1"><Label>Start Date *</Label><Input type="date" {...register('startDate')} /></div>
            <div className="space-y-1"><Label>Salary (RWF) *</Label><Input type="number" {...register('salary')} /></div>
            <div className="space-y-1"><Label>Bank Name *</Label><Input {...register('bankName')} /></div>
            <div className="space-y-1"><Label>Bank Account # *</Label><Input {...register('bankAccountNumber')} /></div>
            <DialogFooter className="col-span-2 mt-2">
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
        title="Delete Employee"
        description="Delete this employee record? This cannot be reversed."
        confirmLabel="Delete"
        onConfirm={() => deleteId && deleteMutation.mutate(deleteId)}
        isLoading={deleteMutation.isPending}
      />
    </div>
  );
}
