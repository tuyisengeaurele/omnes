import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/axios';
import { PageHeader } from '@/components/shared/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowLeft, Truck, Plus } from 'lucide-react';
import { formatCurrency, formatDate } from '@/lib/utils';

interface POLine {
  id: string;
  quantity: number;
  unitPrice: string;
  rawMaterial: { name: string; unit: string };
}
interface SupplierPayment {
  id: string;
  amount: string;
  paymentDate: string;
  method: string;
}
interface PurchaseOrderDetail {
  id: string;
  poNumber: string;
  orderDate: string;
  status: string;
  totalAmount: string;
  supplier: { name: string; phone: string };
  lines: POLine[];
  payments: SupplierPayment[];
}

const STATUS_COLORS: Record<string, 'warning' | 'secondary' | 'success' | 'destructive'> = {
  PENDING: 'warning',
  ORDERED: 'secondary',
  RECEIVED: 'success',
  CANCELLED: 'destructive',
};

const paymentSchema = z.object({
  amount: z.coerce.number().positive(),
  paymentDate: z.string().min(1),
  method: z.enum(['CASH', 'BANK_TRANSFER', 'MOBILE_MONEY', 'CHEQUE']),
});
type PaymentForm = z.infer<typeof paymentSchema>;

export default function PODetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['purchase-order', id],
    queryFn: async () => {
      const res = await api.get(`/purchase-orders/${id}`);
      return res.data.data as PurchaseOrderDetail;
    },
    enabled: !!id,
  });

  const receiveMutation = useMutation({
    mutationFn: () => api.patch(`/purchase-orders/${id}/receive`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['purchase-order', id] });
      void qc.invalidateQueries({ queryKey: ['raw-materials'] });
      setReceiveOpen(false);
    },
  });

  const paymentForm = useForm<PaymentForm>({
    resolver: zodResolver(paymentSchema),
    defaultValues: { paymentDate: new Date().toISOString().split('T')[0], method: 'BANK_TRANSFER' },
  });
  const paymentMutation = useMutation({
    mutationFn: (values: PaymentForm) => api.post(`/purchase-orders/${id}/payments`, values),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['purchase-order', id] });
      setPaymentOpen(false);
      paymentForm.reset({ paymentDate: new Date().toISOString().split('T')[0], method: 'BANK_TRANSFER' });
    },
  });

  if (isLoading) return <div className="p-8 text-center text-brand-muted">Loading...</div>;
  if (!data) return <div className="p-8 text-center text-brand-muted">Purchase order not found.</div>;

  const totalPaid = data.payments.reduce((sum, p) => sum + Number(p.amount), 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title={`PO ${data.poNumber}`}
        breadcrumbs={[{ label: 'Procurement' }, { label: 'Purchase Orders', href: '/procurement/purchase-orders' }, { label: data.poNumber }]}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <Link to="/procurement/purchase-orders"><ArrowLeft className="h-4 w-4" /> Back</Link>
            </Button>
            {data.status !== 'RECEIVED' && data.status !== 'CANCELLED' && (
              <Button onClick={() => setReceiveOpen(true)}>
                <Truck className="h-4 w-4" /> Receive Goods
              </Button>
            )}
          </div>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card><CardContent className="pt-6"><p className="text-sm text-brand-muted">Supplier</p><p className="text-lg font-bold mt-1">{data.supplier.name}</p></CardContent></Card>
        <Card><CardContent className="pt-6"><p className="text-sm text-brand-muted">Order Date</p><p className="text-lg font-bold mt-1">{formatDate(data.orderDate)}</p></CardContent></Card>
        <Card><CardContent className="pt-6"><p className="text-sm text-brand-muted">Total</p><p className="text-lg font-bold mt-1">{formatCurrency(Number(data.totalAmount))}</p></CardContent></Card>
        <Card><CardContent className="pt-6"><p className="text-sm text-brand-muted">Status</p><div className="mt-1"><Badge variant={STATUS_COLORS[data.status] ?? 'outline'}>{data.status}</Badge></div></CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Line Items</CardTitle></CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/30">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-brand-muted">Material</th>
                <th className="px-4 py-3 text-right font-medium text-brand-muted">Quantity</th>
                <th className="px-4 py-3 text-right font-medium text-brand-muted">Unit Price</th>
                <th className="px-4 py-3 text-right font-medium text-brand-muted">Subtotal</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.lines.map((l) => (
                <tr key={l.id}>
                  <td className="px-4 py-3">{l.rawMaterial.name}</td>
                  <td className="px-4 py-3 text-right">{l.quantity.toLocaleString()} {l.rawMaterial.unit}</td>
                  <td className="px-4 py-3 text-right">{formatCurrency(Number(l.unitPrice))}</td>
                  <td className="px-4 py-3 text-right font-medium">{formatCurrency(l.quantity * Number(l.unitPrice))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Payments — {formatCurrency(totalPaid)} of {formatCurrency(Number(data.totalAmount))} paid</CardTitle>
          <Button size="sm" variant="outline" onClick={() => setPaymentOpen(true)}><Plus className="h-3.5 w-3.5" /> Add Payment</Button>
        </CardHeader>
        <CardContent>
          {data.payments.length === 0 ? (
            <p className="text-sm text-brand-muted text-center py-4">No payments recorded</p>
          ) : (
            <div className="space-y-1">
              {data.payments.map((p) => (
                <div key={p.id} className="flex items-center justify-between py-1.5 border-b last:border-0 text-sm">
                  <span>{formatDate(p.paymentDate)}</span>
                  <Badge variant="outline">{p.method.replace('_', ' ')}</Badge>
                  <span className="font-medium">{formatCurrency(Number(p.amount))}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={receiveOpen}
        onOpenChange={setReceiveOpen}
        title="Receive Goods"
        description="This will mark the PO as received and add the line item quantities to raw material stock."
        confirmLabel="Receive"
        onConfirm={() => receiveMutation.mutate()}
        isLoading={receiveMutation.isPending}
      />

      <Dialog open={paymentOpen} onOpenChange={(o) => { setPaymentOpen(o); if (!o) paymentForm.reset(); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Record Supplier Payment</DialogTitle></DialogHeader>
          <form onSubmit={paymentForm.handleSubmit((v) => paymentMutation.mutate(v))} className="space-y-4 mt-2">
            <div className="space-y-1">
              <Label>Amount *</Label>
              <Input type="number" {...paymentForm.register('amount')} />
            </div>
            <div className="space-y-1">
              <Label>Payment Date *</Label>
              <Input type="date" {...paymentForm.register('paymentDate')} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setPaymentOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={paymentMutation.isPending}>{paymentMutation.isPending ? 'Saving...' : 'Record'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
