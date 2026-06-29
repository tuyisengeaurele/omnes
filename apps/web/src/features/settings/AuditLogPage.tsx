import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/axios';
import { DataTable, type Column } from '@/components/shared/DataTable';
import { PageHeader } from '@/components/shared/PageHeader';
import { Badge } from '@/components/ui/badge';
import { formatDateTime } from '@/lib/utils';
import { useAuth } from '@/features/auth/AuthContext';

interface AuditLog {
  id: string;
  action: string;
  entity: string;
  entityId: string | null;
  createdAt: string;
  ipAddress: string | null;
  user: { firstName: string; lastName: string; email: string };
}

const ACTION_COLORS: Record<string, 'success' | 'warning' | 'destructive' | 'secondary'> = {
  CREATE: 'success',
  UPDATE: 'warning',
  DELETE: 'destructive',
  TOGGLE_STATUS: 'secondary',
  APPROVE: 'success',
  REJECT: 'destructive',
};

export default function AuditLogPage() {
  const { user: currentUser } = useAuth();
  const isAdmin = currentUser?.role === 'ADMIN';

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['audit-logs', page, search],
    queryFn: async () => {
      const res = await api.get('/audit-logs', { params: { page, pageSize: 20, search } });
      return res.data as { data: AuditLog[]; total: number; page: number; pageSize: number };
    },
    enabled: isAdmin,
  });

  const columns: Column<AuditLog>[] = [
    { key: 'createdAt', header: 'Timestamp', render: (r) => formatDateTime(r.createdAt) },
    { key: 'user', header: 'User', render: (r) => `${r.user.firstName} ${r.user.lastName}` },
    { key: 'action', header: 'Action', render: (r) => <Badge variant={ACTION_COLORS[r.action] ?? 'outline'}>{r.action}</Badge> },
    { key: 'entity', header: 'Entity' },
    { key: 'entityId', header: 'Entity ID', render: (r) => <span className="font-mono text-xs">{r.entityId ?? '—'}</span> },
    { key: 'ipAddress', header: 'IP Address', render: (r) => r.ipAddress ?? '—' },
  ];

  if (!isAdmin) {
    return (
      <div className="space-y-6">
        <PageHeader title="Audit Log" breadcrumbs={[{ label: 'Settings' }, { label: 'Audit Log' }]} />
        <div className="rounded-lg border bg-white p-8 text-center text-brand-muted">Only administrators can view the audit log.</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Audit Log" breadcrumbs={[{ label: 'Settings' }, { label: 'Audit Log' }]} />
      <DataTable
        columns={columns}
        data={data?.data ?? []}
        total={data?.total ?? 0}
        page={page}
        pageSize={20}
        onPageChange={setPage}
        onSearch={setSearch}
        isLoading={isLoading}
        searchPlaceholder="Search by action or entity..."
      />
    </div>
  );
}
