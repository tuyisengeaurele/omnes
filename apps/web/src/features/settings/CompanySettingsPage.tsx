import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/axios';
import { PageHeader } from '@/components/shared/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Save } from 'lucide-react';
import { useAuth } from '@/features/auth/AuthContext';
import { toast } from 'sonner';

interface CompanySettings {
  id: string;
  name: string;
  tinNumber: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  website: string | null;
  currency: string;
  vatRate: string;
  financialYearStart: number;
}

const schema = z.object({
  name: z.string().min(1),
  tinNumber: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  address: z.string().optional(),
  website: z.string().optional(),
  currency: z.string().min(1),
  vatRate: z.coerce.number().min(0).max(100),
  financialYearStart: z.coerce.number().int().min(1).max(12),
});
type FormValues = z.infer<typeof schema>;

export default function CompanySettingsPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';

  const { data, isLoading } = useQuery({
    queryKey: ['company-settings'],
    queryFn: async () => {
      const res = await api.get('/company-settings');
      return res.data.data as CompanySettings;
    },
  });

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema),
  });

  useEffect(() => {
    if (data) {
      reset({
        name: data.name,
        tinNumber: data.tinNumber ?? '',
        phone: data.phone ?? '',
        email: data.email ?? '',
        address: data.address ?? '',
        website: data.website ?? '',
        currency: data.currency,
        vatRate: Number(data.vatRate),
        financialYearStart: data.financialYearStart,
      });
    }
  }, [data, reset]);

  const mutation = useMutation({
    mutationFn: (values: FormValues) => api.put('/company-settings', values),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['company-settings'] });
      toast.success('Company settings saved.');
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Something went wrong. Please try again.';
      toast.error(msg);
    },
  });

  if (isLoading) return <div className="p-8 text-center text-brand-muted">Loading settings...</div>;

  return (
    <div className="space-y-6">
      <PageHeader title="Company Settings" breadcrumbs={[{ label: 'Settings' }, { label: 'Company' }]} />

      <Card>
        <CardContent className="p-6">
          <form onSubmit={handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
            <fieldset disabled={!isAdmin} className="space-y-4 disabled:opacity-60">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label>Company Name *</Label>
                  <Input {...register('name')} />
                  {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
                </div>
                <div className="space-y-1">
                  <Label>TIN Number</Label>
                  <Input {...register('tinNumber')} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label>Phone</Label>
                  <Input {...register('phone')} />
                </div>
                <div className="space-y-1">
                  <Label>Email</Label>
                  <Input type="email" {...register('email')} />
                  {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
                </div>
              </div>
              <div className="space-y-1">
                <Label>Address</Label>
                <Input {...register('address')} />
              </div>
              <div className="space-y-1">
                <Label>Website</Label>
                <Input {...register('website')} />
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-1">
                  <Label>Currency *</Label>
                  <Input {...register('currency')} />
                </div>
                <div className="space-y-1">
                  <Label>VAT Rate (%) *</Label>
                  <Input type="number" step="0.01" {...register('vatRate')} />
                </div>
                <div className="space-y-1">
                  <Label>Financial Year Start (Month) *</Label>
                  <Input type="number" min={1} max={12} {...register('financialYearStart')} />
                </div>
              </div>
            </fieldset>
            {isAdmin && (
              <div className="flex justify-end">
                <Button type="submit" disabled={isSubmitting || mutation.isPending}>
                  <Save className="h-4 w-4" /> {mutation.isPending ? 'Saving...' : 'Save Settings'}
                </Button>
              </div>
            )}
            {!isAdmin && <p className="text-xs text-brand-muted">Only administrators can edit company settings.</p>}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
