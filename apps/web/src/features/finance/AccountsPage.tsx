import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/axios';
import { PageHeader } from '@/components/shared/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';

interface Account {
  id: string;
  code: string;
  name: string;
  type: string;
  balance: string;
  parentId: string | null;
}

const schema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE']),
  parentId: z.string().optional(),
});
type FormValues = z.infer<typeof schema>;

const TYPE_COLORS: Record<string, 'success' | 'destructive' | 'secondary' | 'warning' | 'outline'> = {
  ASSET: 'success',
  LIABILITY: 'destructive',
  EQUITY: 'secondary',
  REVENUE: 'success',
  EXPENSE: 'warning',
};

export default function AccountsPage() {
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['accounts'],
    queryFn: async () => {
      const res = await api.get('/accounts', { params: { pageSize: 200 } });
      return res.data.data as Account[];
    },
  });

  const { register, handleSubmit, control, reset, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { type: 'ASSET' },
  });

  const mutation = useMutation({
    mutationFn: (values: FormValues) => api.post('/accounts', values),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['accounts'] });
      setDialogOpen(false);
      reset({ type: 'ASSET' });
    },
  });

  if (isLoading) return <div className="p-8 text-center text-brand-muted">Loading accounts...</div>;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Chart of Accounts"
        breadcrumbs={[{ label: 'Finance' }, { label: 'Accounts' }]}
        actions={
          <Button onClick={() => { reset({ type: 'ASSET' }); setDialogOpen(true); }}>
            <Plus className="h-4 w-4" /> Add Account
          </Button>
        }
      />

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/30">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-brand-muted">Code</th>
                <th className="px-4 py-3 text-left font-medium text-brand-muted">Name</th>
                <th className="px-4 py-3 text-left font-medium text-brand-muted">Type</th>
                <th className="px-4 py-3 text-right font-medium text-brand-muted">Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {(data ?? []).map((a) => (
                <tr key={a.id} className="hover:bg-muted/20">
                  <td className="px-4 py-3 font-mono text-xs">{a.code}</td>
                  <td className="px-4 py-3">{a.name}</td>
                  <td className="px-4 py-3"><Badge variant={TYPE_COLORS[a.type] ?? 'outline'}>{a.type}</Badge></td>
                  <td className="px-4 py-3 text-right font-medium">{formatCurrency(Number(a.balance))}</td>
                </tr>
              ))}
              {(data ?? []).length === 0 && (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-brand-muted">No accounts yet</td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={(o) => { setDialogOpen(o); if (!o) reset({ type: 'ASSET' }); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Account</DialogTitle></DialogHeader>
          <form onSubmit={handleSubmit((v) => mutation.mutate(v))} className="space-y-4 mt-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Code *</Label>
                <Input {...register('code')} placeholder="e.g. 1000" />
                {errors.code && <p className="text-xs text-destructive">{errors.code.message}</p>}
              </div>
              <div className="space-y-1">
                <Label>Type *</Label>
                <Controller name="type" control={control} render={({ field }) => (
                  <Select onValueChange={field.onChange} value={field.value}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'].map((t) => (
                        <SelectItem key={t} value={t}>{t}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )} />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Name *</Label>
              <Input {...register('name')} />
              {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
            </div>
            <div className="space-y-1">
              <Label>Parent Account</Label>
              <Controller name="parentId" control={control} render={({ field }) => (
                <Select onValueChange={field.onChange} value={field.value}>
                  <SelectTrigger><SelectValue placeholder="None (top-level)" /></SelectTrigger>
                  <SelectContent>{(data ?? []).map((a) => <SelectItem key={a.id} value={a.id}>{a.code}: {a.name}</SelectItem>)}</SelectContent>
                </Select>
              )} />
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
    </div>
  );
}
