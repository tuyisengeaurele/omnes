import { useState, useEffect } from 'react';
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
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowLeft, Printer, Plus } from 'lucide-react';
import { formatCurrency, formatDate } from '@/lib/utils';
import type { CompanySettings } from '@/types';
import { toast } from 'sonner';

interface SaleLine {
  id: string;
  quantity: number;
  unitPrice: string;
  productType: { name: string; unit: string };
}
interface SalePayment {
  id: string;
  amount: string;
  paymentDate: string;
  method: string;
}
interface SaleDetail {
  id: string;
  invoiceNumber: string | null;
  proformaNumber: string | null;
  saleDate: string;
  status: string;
  paymentStatus: string;
  totalAmount: string;
  customer: { name: string; phone: string; address: string | null; tinNumber: string | null };
  lines: SaleLine[];
  payments: SalePayment[];
}

const STATUS_COLORS: Record<string, 'warning' | 'secondary' | 'success' | 'destructive'> = {
  PROFORMA: 'warning',
  CONFIRMED: 'secondary',
  DELIVERED: 'success',
  CANCELLED: 'destructive',
};

const paymentSchema = z.object({
  amount: z.coerce.number().positive(),
  paymentDate: z.string().min(1),
  method: z.enum(['CASH', 'BANK_TRANSFER', 'MOBILE_MONEY', 'CHEQUE']),
});
type PaymentForm = z.infer<typeof paymentSchema>;

function PrintableDocument({ sale, company }: { sale: SaleDetail; company: CompanySettings | undefined }) {
  const docTitle = sale.invoiceNumber ? 'INVOICE' : 'PROFORMA INVOICE';
  const docNumber = sale.invoiceNumber ?? sale.proformaNumber;
  const subtotal = sale.lines.reduce((sum, l) => sum + l.quantity * Number(l.unitPrice), 0);

  return (
    <div className="print-document hidden print:block bg-white p-12 text-dark">
      <div className="flex items-start justify-between border-b-2 pb-6" style={{ borderColor: '#C0392B' }}>
        <div>
          <h1 className="text-2xl font-bold">{company?.name ?? 'OMNES'}</h1>
          {company?.address && <p className="text-sm text-brand-muted mt-1">{company.address}</p>}
          {company?.phone && <p className="text-sm text-brand-muted">{company.phone}</p>}
          {company?.tinNumber && <p className="text-sm text-brand-muted">TIN: {company.tinNumber}</p>}
        </div>
        <div className="text-right">
          <h2 className="text-xl font-bold" style={{ color: '#C0392B' }}>{docTitle}</h2>
          <p className="text-sm font-mono mt-1">{docNumber}</p>
          <p className="text-sm text-brand-muted">{formatDate(sale.saleDate)}</p>
        </div>
      </div>

      <div className="mt-6">
        <p className="text-sm font-semibold text-brand-muted uppercase">Bill To</p>
        <p className="font-medium mt-1">{sale.customer.name}</p>
        <p className="text-sm">{sale.customer.phone}</p>
        {sale.customer.address && <p className="text-sm">{sale.customer.address}</p>}
        {sale.customer.tinNumber && <p className="text-sm">TIN: {sale.customer.tinNumber}</p>}
      </div>

      <table className="w-full mt-6 text-sm">
        <thead>
          <tr className="border-b-2" style={{ borderColor: '#2C3E50' }}>
            <th className="text-left py-2">Item</th>
            <th className="text-right py-2">Quantity</th>
            <th className="text-right py-2">Unit Price</th>
            <th className="text-right py-2">Subtotal</th>
          </tr>
        </thead>
        <tbody>
          {sale.lines.map((l) => (
            <tr key={l.id} className="border-b">
              <td className="py-2">{l.productType.name}</td>
              <td className="text-right py-2">{l.quantity.toLocaleString()} {l.productType.unit}</td>
              <td className="text-right py-2">{formatCurrency(Number(l.unitPrice))}</td>
              <td className="text-right py-2">{formatCurrency(l.quantity * Number(l.unitPrice))}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="flex justify-end mt-4">
        <div className="w-64">
          <div className="flex justify-between py-1 font-bold text-lg border-t-2 pt-2" style={{ borderColor: '#2C3E50' }}>
            <span>Total</span>
            <span>{formatCurrency(subtotal)}</span>
          </div>
        </div>
      </div>

      <p className="mt-12 text-xs text-brand-muted text-center">Thank you for your business. {company?.name ?? 'OMNES'}</p>
    </div>
  );
}

export default function SaleDetailPage() {
  useEffect(() => {
    document.title = 'Sale Detail | OMNES ERP';
    return () => { document.title = 'OMNES ERP'; };
  }, []);
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [paymentOpen, setPaymentOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['sale', id],
    queryFn: async () => {
      const res = await api.get(`/sales/${id}`);
      return res.data.data as SaleDetail;
    },
    enabled: !!id,
  });

  const { data: company } = useQuery({
    queryKey: ['company-settings'],
    queryFn: async () => {
      const res = await api.get('/company-settings');
      return res.data.data as CompanySettings;
    },
  });

  const paymentForm = useForm<PaymentForm>({
    resolver: zodResolver(paymentSchema),
    defaultValues: { paymentDate: new Date().toISOString().split('T')[0], method: 'CASH' },
  });
  const paymentMutation = useMutation({
    mutationFn: (values: PaymentForm) => api.post(`/sales/${id}/payments`, values),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['sale', id] });
      setPaymentOpen(false);
      paymentForm.reset({ paymentDate: new Date().toISOString().split('T')[0], method: 'CASH' });
      toast.success('Payment recorded.');
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Something went wrong. Please try again.';
      toast.error(msg);
    },
  });

  if (isLoading) return <div className="p-8 text-center text-brand-muted">Loading...</div>;
  if (!data) return <div className="p-8 text-center text-brand-muted">Sale not found.</div>;

  const totalPaid = data.payments.reduce((sum, p) => sum + Number(p.amount), 0);

  return (
    <>
      <div className="space-y-6 print:hidden">
        <PageHeader
          title={data.invoiceNumber ?? data.proformaNumber ?? 'Sale'}
          breadcrumbs={[{ label: 'Sales' }, { label: 'Invoices', href: '/sales/invoices' }, { label: data.invoiceNumber ?? data.proformaNumber ?? '' }]}
          actions={
            <div className="flex gap-2">
              <Button variant="outline" asChild>
                <Link to="/sales/invoices"><ArrowLeft className="h-4 w-4" /> Back</Link>
              </Button>
              <Button variant="outline" onClick={() => window.print()}>
                <Printer className="h-4 w-4" /> Print
              </Button>
            </div>
          }
        />

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Card><CardContent className="pt-6"><p className="text-sm text-brand-muted">Customer</p><p className="text-lg font-bold mt-1">{data.customer.name}</p></CardContent></Card>
          <Card><CardContent className="pt-6"><p className="text-sm text-brand-muted">Sale Date</p><p className="text-lg font-bold mt-1">{formatDate(data.saleDate)}</p></CardContent></Card>
          <Card><CardContent className="pt-6"><p className="text-sm text-brand-muted">Total</p><p className="text-lg font-bold mt-1">{formatCurrency(Number(data.totalAmount))}</p></CardContent></Card>
          <Card><CardContent className="pt-6"><p className="text-sm text-brand-muted">Status</p><div className="mt-1 flex gap-1"><Badge variant={STATUS_COLORS[data.status] ?? 'outline'}>{data.status}</Badge></div></CardContent></Card>
        </div>

        <Card>
          <CardHeader><CardTitle className="text-base">Line Items</CardTitle></CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/30">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-brand-muted">Product</th>
                  <th className="px-4 py-3 text-right font-medium text-brand-muted">Quantity</th>
                  <th className="px-4 py-3 text-right font-medium text-brand-muted">Unit Price</th>
                  <th className="px-4 py-3 text-right font-medium text-brand-muted">Subtotal</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.lines.map((l) => (
                  <tr key={l.id}>
                    <td className="px-4 py-3">{l.productType.name}</td>
                    <td className="px-4 py-3 text-right">{l.quantity.toLocaleString()} {l.productType.unit}</td>
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
            <CardTitle className="text-base">Payments ({formatCurrency(totalPaid)} of {formatCurrency(Number(data.totalAmount))} received)</CardTitle>
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
      </div>

      <PrintableDocument sale={data} company={company} />

      <Dialog open={paymentOpen} onOpenChange={(o) => { setPaymentOpen(o); if (!o) paymentForm.reset(); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Record Payment</DialogTitle></DialogHeader>
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
    </>
  );
}
