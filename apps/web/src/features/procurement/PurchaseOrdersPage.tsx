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
import { useForm, Controller, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, Eye, Trash2 } from 'lucide-react';
import { formatCurrency, formatDate } from '@/lib/utils';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';

interface PurchaseOrder {
  id: string;
  poNumber: string;
  orderDate: string;
  status: string;
  totalAmount: string;
  supplier: { name: string };
}

const lineSchema = z.object({
  rawMaterialId: z.string().min(1),
  quantity: z.coerce.number().positive(),
  unitPrice: z.coerce.number().positive(),
});

const schema = z.object({
  supplierId: z.string().min(1),
  orderDate: z.string().min(1),
  lines: z.array(lineSchema).min(1),
});
type FormValues = z.infer<typeof schema>;

const STATUS_COLORS: Record<string, 'warning' | 'secondary' | 'success' | 'destructive'> = {
  PENDING: 'warning',
  ORDERED: 'secondary',
  RECEIVED: 'success',
  CANCELLED: 'destructive',
};

export default function PurchaseOrdersPage() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['purchase-orders', page, search],
    queryFn: async () => {
      const res = await api.get('/purchase-orders', { params: { page, pageSize: 20, search } });
      return res.data as { data: PurchaseOrder[]; total: number; page: number; pageSize: number };
    },
  });

  const { data: suppliers } = useQuery({
    queryKey: ['suppliers-list'],
    queryFn: async () => {
      const res = await api.get('/suppliers', { params: { pageSize: 100 } });
      return res.data.data as Array<{ id: string; name: string }>;
    },
  });

  const { data: materials } = useQuery({
    queryKey: ['raw-materials-list'],
    queryFn: async () => {
      const res = await api.get('/raw-materials', { params: { pageSize: 100 } });
      return res.data.data as Array<{ id: string; name: string; unit: string }>;
    },
  });

  const { register, handleSubmit, control, reset, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { orderDate: new Date().toISOString().split('T')[0], lines: [{ rawMaterialId: '', quantity: 1, unitPrice: 0 }] },
  });
  const { fields, append, remove } = useFieldArray({ control, name: 'lines' });

  const mutation = useMutation({
    mutationFn: (values: FormValues) => api.post('/purchase-orders', values),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['purchase-orders'] });
      setDialogOpen(false);
      reset({ orderDate: new Date().toISOString().split('T')[0], lines: [{ rawMaterialId: '', quantity: 1, unitPrice: 0 }] });
      toast.success('Purchase order created.');
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Something went wrong. Please try again.';
      toast.error(msg);
    },
  });

  const columns: Column<PurchaseOrder>[] = [
    { key: 'poNumber', header: 'PO #', className: 'font-mono text-xs' },
    { key: 'supplier', header: 'Supplier', render: (r) => r.supplier.name },
    { key: 'orderDate', header: 'Order Date', render: (r) => formatDate(r.orderDate) },
    { key: 'totalAmount', header: 'Total', render: (r) => formatCurrency(Number(r.totalAmount)) },
    { key: 'status', header: 'Status', render: (r) => <Badge variant={STATUS_COLORS[r.status] ?? 'outline'}>{r.status}</Badge> },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Purchase Orders"
        breadcrumbs={[{ label: 'Procurement' }, { label: 'Purchase Orders' }]}
        actions={
          <Button onClick={() => { reset({ orderDate: new Date().toISOString().split('T')[0], lines: [{ rawMaterialId: '', quantity: 1, unitPrice: 0 }] }); setDialogOpen(true); }}>
            <Plus className="h-4 w-4" /> New PO
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
        searchPlaceholder="Search purchase orders..."
        actions={(row) => (
          <div className="flex items-center justify-end">
            <Button variant="ghost" size="icon" asChild>
              <Link to={`/procurement/purchase-orders/${row.id}`}><Eye className="h-4 w-4" /></Link>
            </Button>
          </div>
        )}
      />

      <Dialog open={dialogOpen} onOpenChange={(o) => setDialogOpen(o)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New Purchase Order</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit((v) => mutation.mutate(v))} className="space-y-4 mt-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Supplier *</Label>
                <Controller name="supplierId" control={control} render={({ field }) => (
                  <Select onValueChange={field.onChange} value={field.value}>
                    <SelectTrigger><SelectValue placeholder="Select supplier" /></SelectTrigger>
                    <SelectContent>{suppliers?.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
                  </Select>
                )} />
                {errors.supplierId && <p className="text-xs text-destructive">Required</p>}
              </div>
              <div className="space-y-1">
                <Label>Order Date *</Label>
                <Input type="date" {...register('orderDate')} />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Line Items *</Label>
                <Button type="button" size="sm" variant="outline" onClick={() => append({ rawMaterialId: '', quantity: 1, unitPrice: 0 })}>
                  <Plus className="h-3.5 w-3.5" /> Add Line
                </Button>
              </div>
              {fields.map((field, index) => (
                <div key={field.id} className="grid grid-cols-[2fr_1fr_1fr_auto] gap-2 items-end">
                  <Controller name={`lines.${index}.rawMaterialId`} control={control} render={({ field: f }) => (
                    <Select onValueChange={f.onChange} value={f.value}>
                      <SelectTrigger><SelectValue placeholder="Material" /></SelectTrigger>
                      <SelectContent>{materials?.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}</SelectContent>
                    </Select>
                  )} />
                  <Input type="number" placeholder="Qty" {...register(`lines.${index}.quantity`)} />
                  <Input type="number" placeholder="Unit Price" {...register(`lines.${index}.unitPrice`)} />
                  <Button type="button" variant="ghost" size="icon" className="text-destructive" onClick={() => remove(index)} disabled={fields.length === 1}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={isSubmitting || mutation.isPending}>
                {mutation.isPending ? 'Creating...' : 'Create PO'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
