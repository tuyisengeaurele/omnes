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
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus } from 'lucide-react';
import { formatCurrency, formatDate } from '@/lib/utils';

interface Expense {
  id: string;
  category: string;
  description: string;
  amount: string;
  expenseDate: string;
}

const schema = z.object({
  category: z.enum(['UTILITIES', 'FUEL', 'MAINTENANCE', 'TRANSPORT', 'OFFICE', 'OTHER']),
  description: z.string().min(1),
  amount: z.coerce.number().positive(),
  expenseDate: z.string().min(1),
});
type FormValues = z.infer<typeof schema>;

export default function ExpensesPage() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['expenses', page, search],
    queryFn: async () => {
      const res = await api.get('/expenses', { params: { page, pageSize: 20, search } });
      return res.data as { data: Expense[]; total: number; page: number; pageSize: number };
    },
  });

  const { register, handleSubmit, control, reset, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { category: 'OTHER', expenseDate: new Date().toISOString().split('T')[0] },
  });

  const mutation = useMutation({
    mutationFn: (values: FormValues) => api.post('/expenses', values),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['expenses'] });
      setDialogOpen(false);
      reset({ category: 'OTHER', expenseDate: new Date().toISOString().split('T')[0] });
    },
  });

  const columns: Column<Expense>[] = [
    { key: 'expenseDate', header: 'Date', render: (r) => formatDate(r.expenseDate) },
    { key: 'category', header: 'Category', render: (r) => <Badge variant="outline">{r.category}</Badge> },
    { key: 'description', header: 'Description' },
    { key: 'amount', header: 'Amount', render: (r) => formatCurrency(Number(r.amount)) },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Expenses"
        breadcrumbs={[{ label: 'Finance' }, { label: 'Expenses' }]}
        actions={
          <Button onClick={() => { reset({ category: 'OTHER', expenseDate: new Date().toISOString().split('T')[0] }); setDialogOpen(true); }}>
            <Plus className="h-4 w-4" /> Record Expense
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
        searchPlaceholder="Search expenses..."
      />

      <Dialog open={dialogOpen} onOpenChange={(o) => { setDialogOpen(o); if (!o) reset({ category: 'OTHER', expenseDate: new Date().toISOString().split('T')[0] }); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Record Expense</DialogTitle></DialogHeader>
          <form onSubmit={handleSubmit((v) => mutation.mutate(v))} className="space-y-4 mt-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Category *</Label>
                <Controller name="category" control={control} render={({ field }) => (
                  <Select onValueChange={field.onChange} value={field.value}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {['UTILITIES', 'FUEL', 'MAINTENANCE', 'TRANSPORT', 'OFFICE', 'OTHER'].map((c) => (
                        <SelectItem key={c} value={c}>{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )} />
              </div>
              <div className="space-y-1">
                <Label>Date *</Label>
                <Input type="date" {...register('expenseDate')} />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Description *</Label>
              <Input {...register('description')} />
              {errors.description && <p className="text-xs text-destructive">{errors.description.message}</p>}
            </div>
            <div className="space-y-1">
              <Label>Amount (RWF) *</Label>
              <Input type="number" {...register('amount')} />
              {errors.amount && <p className="text-xs text-destructive">{errors.amount.message}</p>}
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
