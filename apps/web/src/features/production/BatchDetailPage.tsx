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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowLeft, Plus } from 'lucide-react';
import { formatDate } from '@/lib/utils';

interface MaterialUsage {
  id: string;
  quantity: number;
  rawMaterial: { name: string; unit: string };
}
interface BatchOutput {
  id: string;
  quantity: number;
  qualityGrade: string;
  createdAt: string;
}
interface BatchDetail {
  id: string;
  batchNumber: string;
  startDate: string;
  endDate: string | null;
  status: string;
  quantity: number;
  notes: string | null;
  kiln: { name: string };
  productType: { name: string; unit: string };
  materialUsages: MaterialUsage[];
  outputs: BatchOutput[];
}

const STATUSES = ['LOADING', 'FIRING', 'COOLING', 'COMPLETED', 'FAILED'];

const outputSchema = z.object({
  quantity: z.coerce.number().positive(),
  qualityGrade: z.enum(['A', 'B', 'C', 'REJECTED']),
});
type OutputForm = z.infer<typeof outputSchema>;

const usageSchema = z.object({
  rawMaterialId: z.string().min(1),
  quantity: z.coerce.number().positive(),
});
type UsageForm = z.infer<typeof usageSchema>;

export default function BatchDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [outputDialogOpen, setOutputDialogOpen] = useState(false);
  const [usageDialogOpen, setUsageDialogOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['batch', id],
    queryFn: async () => {
      const res = await api.get(`/batches/${id}`);
      return res.data.data as BatchDetail;
    },
    enabled: !!id,
  });

  const { data: materials } = useQuery({
    queryKey: ['raw-materials-list'],
    queryFn: async () => {
      const res = await api.get('/raw-materials', { params: { pageSize: 100 } });
      return res.data.data as Array<{ id: string; name: string; unit: string }>;
    },
  });

  const statusMutation = useMutation({
    mutationFn: (status: string) => api.patch(`/batches/${id}/status`, { status }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['batch', id] }),
  });

  const outputForm = useForm<OutputForm>({ resolver: zodResolver(outputSchema), defaultValues: { qualityGrade: 'A' } });
  const outputMutation = useMutation({
    mutationFn: (values: OutputForm) => api.post(`/batches/${id}/outputs`, values),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['batch', id] });
      setOutputDialogOpen(false);
      outputForm.reset({ qualityGrade: 'A' });
    },
  });

  const usageForm = useForm<UsageForm>({ resolver: zodResolver(usageSchema) });
  const usageMutation = useMutation({
    mutationFn: (values: UsageForm) => api.post(`/batches/${id}/material-usage`, values),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['batch', id] });
      setUsageDialogOpen(false);
      usageForm.reset();
    },
  });

  if (isLoading) return <div className="p-8 text-center text-brand-muted">Loading batch...</div>;
  if (!data) return <div className="p-8 text-center text-brand-muted">Batch not found.</div>;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Batch ${data.batchNumber}`}
        breadcrumbs={[{ label: 'Production' }, { label: 'Batches', href: '/production/batches' }, { label: data.batchNumber }]}
        actions={
          <Button variant="outline" asChild>
            <Link to="/production/batches"><ArrowLeft className="h-4 w-4" /> Back</Link>
          </Button>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card><CardContent className="pt-6"><p className="text-sm text-brand-muted">Product</p><p className="text-lg font-bold mt-1">{data.productType.name}</p></CardContent></Card>
        <Card><CardContent className="pt-6"><p className="text-sm text-brand-muted">Kiln</p><p className="text-lg font-bold mt-1">{data.kiln.name}</p></CardContent></Card>
        <Card><CardContent className="pt-6"><p className="text-sm text-brand-muted">Target Quantity</p><p className="text-lg font-bold mt-1">{data.quantity.toLocaleString()}</p></CardContent></Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-brand-muted">Status</p>
            <div className="mt-2">
              <Select value={data.status} onValueChange={(v) => statusMutation.mutate(v)}>
                <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Material Usage</CardTitle>
            <Button size="sm" variant="outline" onClick={() => setUsageDialogOpen(true)}><Plus className="h-3.5 w-3.5" /> Add</Button>
          </CardHeader>
          <CardContent>
            {data.materialUsages.length === 0 ? (
              <p className="text-sm text-brand-muted text-center py-4">No material usage recorded</p>
            ) : (
              <div className="space-y-1">
                {data.materialUsages.map((m) => (
                  <div key={m.id} className="flex justify-between py-1.5 border-b last:border-0 text-sm">
                    <span>{m.rawMaterial.name}</span>
                    <span className="font-medium">{m.quantity.toLocaleString()} {m.rawMaterial.unit}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Outputs</CardTitle>
            <Button size="sm" variant="outline" onClick={() => setOutputDialogOpen(true)}><Plus className="h-3.5 w-3.5" /> Add</Button>
          </CardHeader>
          <CardContent>
            {data.outputs.length === 0 ? (
              <p className="text-sm text-brand-muted text-center py-4">No outputs recorded yet</p>
            ) : (
              <div className="space-y-1">
                {data.outputs.map((o) => (
                  <div key={o.id} className="flex items-center justify-between py-1.5 border-b last:border-0 text-sm">
                    <span>{formatDate(o.createdAt)}</span>
                    <span className="font-medium">{o.quantity.toLocaleString()} {data.productType.unit}</span>
                    <Badge variant={o.qualityGrade === 'REJECTED' ? 'destructive' : 'success'}>{o.qualityGrade}</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {data.notes && (
        <Card>
          <CardHeader><CardTitle className="text-base">Notes</CardTitle></CardHeader>
          <CardContent><p className="text-sm text-brand-muted">{data.notes}</p></CardContent>
        </Card>
      )}

      <Dialog open={usageDialogOpen} onOpenChange={(o) => { setUsageDialogOpen(o); if (!o) usageForm.reset(); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Record Material Usage</DialogTitle></DialogHeader>
          <form onSubmit={usageForm.handleSubmit((v) => usageMutation.mutate(v))} className="space-y-4 mt-2">
            <div className="space-y-1">
              <Label>Raw Material *</Label>
              <Controller name="rawMaterialId" control={usageForm.control} render={({ field }) => (
                <Select onValueChange={field.onChange} value={field.value}>
                  <SelectTrigger><SelectValue placeholder="Select material" /></SelectTrigger>
                  <SelectContent>{materials?.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}</SelectContent>
                </Select>
              )} />
            </div>
            <div className="space-y-1">
              <Label>Quantity Used *</Label>
              <Input type="number" {...usageForm.register('quantity')} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setUsageDialogOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={usageMutation.isPending}>{usageMutation.isPending ? 'Saving...' : 'Record'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={outputDialogOpen} onOpenChange={(o) => { setOutputDialogOpen(o); if (!o) outputForm.reset({ qualityGrade: 'A' }); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Record Batch Output</DialogTitle></DialogHeader>
          <form onSubmit={outputForm.handleSubmit((v) => outputMutation.mutate(v))} className="space-y-4 mt-2">
            <div className="space-y-1">
              <Label>Quantity *</Label>
              <Input type="number" {...outputForm.register('quantity')} />
            </div>
            <div className="space-y-1">
              <Label>Quality Grade *</Label>
              <Controller name="qualityGrade" control={outputForm.control} render={({ field }) => (
                <Select onValueChange={field.onChange} value={field.value}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {['A', 'B', 'C', 'REJECTED'].map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}
                  </SelectContent>
                </Select>
              )} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOutputDialogOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={outputMutation.isPending}>{outputMutation.isPending ? 'Saving...' : 'Record'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
