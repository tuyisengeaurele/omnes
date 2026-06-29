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

interface Sale {
  id: string;
  invoiceNumber: string | null;
  proformaNumber: string | null;
  saleDate: string;
  status: string;
  paymentStatus: string;
  totalAmount: string;
  customer: { name: string };
}

const lineSchema = z.object({
  productTypeId: z.string().min(1),
  quantity: z.coerce.number().positive(),
  unitPrice: z.coerce.number().positive(),
});

const schema = z.object({
  customerId: z.string().min(1),
  saleDate: z.string().min(1),
  lines: z.array(lineSchema).min(1),
});
type FormValues = z.infer<typeof schema>;

const STATUS_COLORS: Record<string, 'warning' | 'secondary' | 'success' | 'destructive'> = {
  PROFORMA: 'warning',
  CONFIRMED: 'secondary',
  DELIVERED: 'success',
  CANCELLED: 'destructive',
};

const PAYMENT_COLORS: Record<string, 'destructive' | 'warning' | 'success'> = {
  UNPAID: 'destructive',
  PARTIAL: 'warning',
  PAID: 'success',
};

export default function SalesPage() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['sales', page, search],
    queryFn: async () => {
      const res = await api.get('/sales', { params: { page, pageSize: 20, search } });
      return res.data as { data: Sale[]; total: number; page: number; pageSize: number };
    },
  });

  const { data: customers } = useQuery({
    queryKey: ['customers-list'],
    queryFn: async () => {
      const res = await api.get('/customers', { params: { pageSize: 100 } });
      return res.data.data as Array<{ id: string; name: string }>;
    },
  });

  const { data: productTypes } = useQuery({
    queryKey: ['product-types-list'],
    queryFn: async () => {
      const res = await api.get('/product-types', { params: { pageSize: 100 } });
      return res.data.data as Array<{ id: string; name: string; standardPrice: string }>;
    },
  });

  const { register, handleSubmit, control, reset, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { saleDate: new Date().toISOString().split('T')[0], lines: [{ productTypeId: '', quantity: 1, unitPrice: 0 }] },
  });
  const { fields, append, remove } = useFieldArray({ control, name: 'lines' });

  const mutation = useMutation({
    mutationFn: (values: FormValues) => api.post('/sales', values),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['sales'] });
      setDialogOpen(false);
      reset({ saleDate: new Date().toISOString().split('T')[0], lines: [{ productTypeId: '', quantity: 1, unitPrice: 0 }] });
    },
  });

  const columns: Column<Sale>[] = [
    { key: 'number', header: 'Number', render: (r) => <span className="font-mono text-xs">{r.invoiceNumber ?? r.proformaNumber}</span> },
    { key: 'customer', header: 'Customer', render: (r) => r.customer.name },
    { key: 'saleDate', header: 'Date', render: (r) => formatDate(r.saleDate) },
    { key: 'totalAmount', header: 'Total', render: (r) => formatCurrency(Number(r.totalAmount)) },
    { key: 'status', header: 'Status', render: (r) => <Badge variant={STATUS_COLORS[r.status] ?? 'outline'}>{r.status}</Badge> },
    { key: 'paymentStatus', header: 'Payment', render: (r) => <Badge variant={PAYMENT_COLORS[r.paymentStatus] ?? 'outline'}>{r.paymentStatus}</Badge> },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sales and Invoices"
        breadcrumbs={[{ label: 'Sales' }, { label: 'Invoices' }]}
        actions={
          <Button onClick={() => { reset({ saleDate: new Date().toISOString().split('T')[0], lines: [{ productTypeId: '', quantity: 1, unitPrice: 0 }] }); setDialogOpen(true); }}>
            <Plus className="h-4 w-4" /> New Sale
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
        searchPlaceholder="Search sales..."
        actions={(row) => (
          <div className="flex items-center justify-end">
            <Button variant="ghost" size="icon" asChild>
              <Link to={`/sales/invoices/${row.id}`}><Eye className="h-4 w-4" /></Link>
            </Button>
          </div>
        )}
      />

      <Dialog open={dialogOpen} onOpenChange={(o) => setDialogOpen(o)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New Sale</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit((v) => mutation.mutate(v))} className="space-y-4 mt-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Customer *</Label>
                <Controller name="customerId" control={control} render={({ field }) => (
                  <Select onValueChange={field.onChange} value={field.value}>
                    <SelectTrigger><SelectValue placeholder="Select customer" /></SelectTrigger>
                    <SelectContent>{customers?.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                  </Select>
                )} />
                {errors.customerId && <p className="text-xs text-destructive">Required</p>}
              </div>
              <div className="space-y-1">
                <Label>Sale Date *</Label>
                <Input type="date" {...register('saleDate')} />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Line Items *</Label>
                <Button type="button" size="sm" variant="outline" onClick={() => append({ productTypeId: '', quantity: 1, unitPrice: 0 })}>
                  <Plus className="h-3.5 w-3.5" /> Add Line
                </Button>
              </div>
              {fields.map((field, index) => (
                <div key={field.id} className="grid grid-cols-[2fr_1fr_1fr_auto] gap-2 items-end">
                  <Controller name={`lines.${index}.productTypeId`} control={control} render={({ field: f }) => (
                    <Select onValueChange={f.onChange} value={f.value}>
                      <SelectTrigger><SelectValue placeholder="Product" /></SelectTrigger>
                      <SelectContent>{productTypes?.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
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
                {mutation.isPending ? 'Creating...' : 'Create Sale'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
