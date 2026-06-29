import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/axios';
import { DataTable, type Column } from '@/components/shared/DataTable';
import { PageHeader } from '@/components/shared/PageHeader';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useForm, Controller, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, Trash2 } from 'lucide-react';
import { formatCurrency, formatDate } from '@/lib/utils';

interface JournalEntry {
  id: string;
  entryDate: string;
  description: string;
  totalDebit: string;
  totalCredit: string;
}

const lineSchema = z.object({
  accountId: z.string().min(1),
  debit: z.coerce.number().nonnegative(),
  credit: z.coerce.number().nonnegative(),
});

const schema = z.object({
  entryDate: z.string().min(1),
  description: z.string().min(1),
  lines: z.array(lineSchema).min(2),
});
type FormValues = z.infer<typeof schema>;

export default function JournalPage() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['journal-entries', page, search],
    queryFn: async () => {
      const res = await api.get('/journal-entries', { params: { page, pageSize: 20, search } });
      return res.data as { data: JournalEntry[]; total: number; page: number; pageSize: number };
    },
  });

  const { data: accounts } = useQuery({
    queryKey: ['accounts-list'],
    queryFn: async () => {
      const res = await api.get('/accounts', { params: { pageSize: 200 } });
      return res.data.data as Array<{ id: string; code: string; name: string }>;
    },
  });

  const { register, handleSubmit, control, reset, watch, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { entryDate: new Date().toISOString().split('T')[0], lines: [{ accountId: '', debit: 0, credit: 0 }, { accountId: '', debit: 0, credit: 0 }] },
  });
  const { fields, append, remove } = useFieldArray({ control, name: 'lines' });
  const lines = watch('lines');
  const totalDebit = lines?.reduce((s, l) => s + Number(l.debit || 0), 0) ?? 0;
  const totalCredit = lines?.reduce((s, l) => s + Number(l.credit || 0), 0) ?? 0;
  const isBalanced = totalDebit === totalCredit && totalDebit > 0;

  const mutation = useMutation({
    mutationFn: (values: FormValues) => api.post('/journal-entries', values),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['journal-entries'] });
      setDialogOpen(false);
      reset({ entryDate: new Date().toISOString().split('T')[0], lines: [{ accountId: '', debit: 0, credit: 0 }, { accountId: '', debit: 0, credit: 0 }] });
    },
  });

  const columns: Column<JournalEntry>[] = [
    { key: 'entryDate', header: 'Date', render: (r) => formatDate(r.entryDate) },
    { key: 'description', header: 'Description' },
    { key: 'totalDebit', header: 'Debit', render: (r) => formatCurrency(Number(r.totalDebit)) },
    { key: 'totalCredit', header: 'Credit', render: (r) => formatCurrency(Number(r.totalCredit)) },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Journal Entries"
        breadcrumbs={[{ label: 'Finance' }, { label: 'Journal' }]}
        actions={
          <Button onClick={() => { reset({ entryDate: new Date().toISOString().split('T')[0], lines: [{ accountId: '', debit: 0, credit: 0 }, { accountId: '', debit: 0, credit: 0 }] }); setDialogOpen(true); }}>
            <Plus className="h-4 w-4" /> New Entry
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
        searchPlaceholder="Search journal entries..."
      />

      <Dialog open={dialogOpen} onOpenChange={(o) => setDialogOpen(o)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>New Journal Entry</DialogTitle></DialogHeader>
          <form onSubmit={handleSubmit((v) => mutation.mutate(v))} className="space-y-4 mt-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Entry Date *</Label>
                <Input type="date" {...register('entryDate')} />
              </div>
              <div className="space-y-1">
                <Label>Description *</Label>
                <Input {...register('description')} />
                {errors.description && <p className="text-xs text-destructive">{errors.description.message}</p>}
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Lines * (must balance)</Label>
                <Button type="button" size="sm" variant="outline" onClick={() => append({ accountId: '', debit: 0, credit: 0 })}>
                  <Plus className="h-3.5 w-3.5" /> Add Line
                </Button>
              </div>
              {fields.map((field, index) => (
                <div key={field.id} className="grid grid-cols-[2fr_1fr_1fr_auto] gap-2 items-end">
                  <Controller name={`lines.${index}.accountId`} control={control} render={({ field: f }) => (
                    <Select onValueChange={f.onChange} value={f.value}>
                      <SelectTrigger><SelectValue placeholder="Account" /></SelectTrigger>
                      <SelectContent>{accounts?.map((a) => <SelectItem key={a.id} value={a.id}>{a.code} — {a.name}</SelectItem>)}</SelectContent>
                    </Select>
                  )} />
                  <Input type="number" placeholder="Debit" {...register(`lines.${index}.debit`)} />
                  <Input type="number" placeholder="Credit" {...register(`lines.${index}.credit`)} />
                  <Button type="button" variant="ghost" size="icon" className="text-destructive" onClick={() => remove(index)} disabled={fields.length === 2}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <div className="flex justify-end gap-6 text-sm pt-2 border-t">
                <span>Total Debit: <strong>{formatCurrency(totalDebit)}</strong></span>
                <span>Total Credit: <strong>{formatCurrency(totalCredit)}</strong></span>
                {!isBalanced && <span className="text-destructive">Entry does not balance</span>}
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={isSubmitting || mutation.isPending || !isBalanced}>
                {mutation.isPending ? 'Posting...' : 'Post Entry'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
