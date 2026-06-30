import { useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/axios';
import { PageHeader } from '@/components/shared/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatCurrency, formatDate } from '@/lib/utils';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface EmployeeDetail {
  id: string;
  employeeNumber: string;
  firstName: string;
  lastName: string;
  gender: string;
  dateOfBirth: string;
  nationalId: string;
  phone: string;
  email: string | null;
  address: string;
  position: string;
  contractType: string;
  status: string;
  salary: string;
  startDate: string;
  bankName: string;
  bankAccountNumber: string;
  department: { name: string };
  attendances: Array<{ id: string; date: string; status: string }>;
  leaveRequests: Array<{ id: string; leaveType: string; startDate: string; endDate: string; status: string }>;
}

const STATUS_COLORS: Record<string, 'success' | 'warning' | 'destructive' | 'secondary'> = {
  ACTIVE: 'success',
  ON_LEAVE: 'warning',
  SUSPENDED: 'destructive',
  TERMINATED: 'secondary',
};

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between py-2.5 border-b last:border-0">
      <span className="text-sm text-brand-muted w-40 shrink-0">{label}</span>
      <span className="text-sm font-medium text-right">{value}</span>
    </div>
  );
}

export default function EmployeeDetailPage() {
  useEffect(() => {
    document.title = 'Employee Detail | OMNES ERP';
    return () => { document.title = 'OMNES ERP'; };
  }, []);
  const { id } = useParams<{ id: string }>();

  const { data, isLoading } = useQuery({
    queryKey: ['employee', id],
    queryFn: async () => {
      const res = await api.get(`/employees/${id}`);
      return res.data.data as EmployeeDetail;
    },
    enabled: !!id,
  });

  if (isLoading) return <div className="p-8 text-center text-brand-muted">Loading employee...</div>;
  if (!data) return <div className="p-8 text-center text-brand-muted">Employee not found.</div>;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${data.firstName} ${data.lastName}`}
        breadcrumbs={[{ label: 'HR' }, { label: 'Employees', href: '/hr/employees' }, { label: `${data.firstName} ${data.lastName}` }]}
        actions={
          <Button variant="outline" asChild>
            <Link to="/hr/employees"><ArrowLeft className="h-4 w-4" /> Back</Link>
          </Button>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="text-base">Personal Information</CardTitle></CardHeader>
          <CardContent>
            <DetailRow label="Employee #" value={<span className="font-mono">{data.employeeNumber}</span>} />
            <DetailRow label="Full Name" value={`${data.firstName} ${data.lastName}`} />
            <DetailRow label="Gender" value={data.gender} />
            <DetailRow label="Date of Birth" value={formatDate(data.dateOfBirth)} />
            <DetailRow label="National ID" value={<span className="font-mono">{data.nationalId}</span>} />
            <DetailRow label="Phone" value={data.phone} />
            <DetailRow label="Email" value={data.email ?? '-'} />
            <DetailRow label="Address" value={data.address} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Employment Details</CardTitle></CardHeader>
          <CardContent>
            <DetailRow label="Department" value={data.department.name} />
            <DetailRow label="Position" value={data.position} />
            <DetailRow label="Contract Type" value={<Badge variant="outline">{data.contractType}</Badge>} />
            <DetailRow label="Status" value={<Badge variant={STATUS_COLORS[data.status] ?? 'outline'}>{data.status}</Badge>} />
            <DetailRow label="Start Date" value={formatDate(data.startDate)} />
            <DetailRow label="Salary" value={formatCurrency(Number(data.salary))} />
            <DetailRow label="Bank" value={data.bankName} />
            <DetailRow label="Account #" value={<span className="font-mono">{data.bankAccountNumber}</span>} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Recent Attendance</CardTitle></CardHeader>
          <CardContent>
            {data.attendances.length === 0 ? (
              <p className="text-sm text-brand-muted text-center py-4">No attendance records</p>
            ) : (
              <div className="space-y-1">
                {data.attendances.slice(0, 10).map((a) => (
                  <div key={a.id} className="flex justify-between py-1.5 border-b last:border-0 text-sm">
                    <span className="text-brand-muted">{formatDate(a.date)}</span>
                    <Badge variant={a.status === 'PRESENT' ? 'success' : a.status === 'ABSENT' ? 'destructive' : 'warning'}>
                      {a.status}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Leave History</CardTitle></CardHeader>
          <CardContent>
            {data.leaveRequests.length === 0 ? (
              <p className="text-sm text-brand-muted text-center py-4">No leave requests</p>
            ) : (
              <div className="space-y-1">
                {data.leaveRequests.slice(0, 10).map((l) => (
                  <div key={l.id} className="flex items-center justify-between py-1.5 border-b last:border-0 text-sm">
                    <div>
                      <span className="font-medium">{l.leaveType}</span>
                      <span className="text-brand-muted ml-2">{formatDate(l.startDate)} to {formatDate(l.endDate)}</span>
                    </div>
                    <Badge variant={l.status === 'APPROVED' ? 'success' : l.status === 'REJECTED' ? 'destructive' : 'warning'}>
                      {l.status}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
