import { createBrowserRouter, Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '@/features/auth/AuthContext';
import MainLayout from '@/components/layout/MainLayout';
import LoginPage from '@/features/auth/LoginPage';
import DashboardPage from '@/features/dashboard/DashboardPage';
import NotFoundPage from '@/components/shared/NotFoundPage';

// HR
import EmployeesPage from '@/features/hr/EmployeesPage';
import EmployeeDetailPage from '@/features/hr/EmployeeDetailPage';
import DepartmentsPage from '@/features/hr/DepartmentsPage';
import AttendancePage from '@/features/hr/AttendancePage';
import LeavePage from '@/features/hr/LeavePage';
import PayrollPage from '@/features/hr/PayrollPage';
import PayrollRunPage from '@/features/hr/PayrollRunPage';

// Production
import BatchesPage from '@/features/production/BatchesPage';
import BatchDetailPage from '@/features/production/BatchDetailPage';
import KilnsPage from '@/features/production/KilnsPage';
import ProductTypesPage from '@/features/production/ProductTypesPage';

// Inventory
import MaterialsPage from '@/features/inventory/MaterialsPage';
import MovementsPage from '@/features/inventory/MovementsPage';

// Procurement
import SuppliersPage from '@/features/procurement/SuppliersPage';
import PurchaseOrdersPage from '@/features/procurement/PurchaseOrdersPage';
import PODetailPage from '@/features/procurement/PODetailPage';

// Sales
import CustomersPage from '@/features/sales/CustomersPage';
import SalesPage from '@/features/sales/SalesPage';
import SaleDetailPage from '@/features/sales/SaleDetailPage';

// Finance
import AccountsPage from '@/features/finance/AccountsPage';
import JournalPage from '@/features/finance/JournalPage';
import ExpensesPage from '@/features/finance/ExpensesPage';

// Assets
import AssetsPage from '@/features/assets/AssetsPage';
import MaintenancePage from '@/features/assets/MaintenancePage';

// Reports
import ReportsPage from '@/features/reports/ReportsPage';
import ProductionReportPage from '@/features/reports/ProductionReportPage';
import SalesReportPage from '@/features/reports/SalesReportPage';
import ProfitLossPage from '@/features/reports/ProfitLossPage';

// Settings
import CompanySettingsPage from '@/features/settings/CompanySettingsPage';
import UsersPage from '@/features/settings/UsersPage';
import AuditLogPage from '@/features/settings/AuditLogPage';

function ProtectedRoute() {
  const { user, isLoading } = useAuth();
  if (isLoading) return <div className="flex items-center justify-center h-screen"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>;
  if (!user) return <Navigate to="/login" replace />;
  return <Outlet />;
}

function AdminRoute() {
  const { user } = useAuth();
  if (user?.role !== 'ADMIN') return <Navigate to="/dashboard" replace />;
  return <Outlet />;
}

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <MainLayout />,
        children: [
          { path: '/', element: <Navigate to="/dashboard" replace /> },
          { path: '/dashboard', element: <DashboardPage /> },
          { path: '/hr/employees', element: <EmployeesPage /> },
          { path: '/hr/employees/:id', element: <EmployeeDetailPage /> },
          { path: '/hr/departments', element: <DepartmentsPage /> },
          { path: '/hr/attendance', element: <AttendancePage /> },
          { path: '/hr/leave', element: <LeavePage /> },
          { path: '/hr/payroll', element: <PayrollPage /> },
          { path: '/hr/payroll/:runId', element: <PayrollRunPage /> },
          { path: '/production/batches', element: <BatchesPage /> },
          { path: '/production/batches/:id', element: <BatchDetailPage /> },
          { path: '/production/kilns', element: <KilnsPage /> },
          { path: '/production/products', element: <ProductTypesPage /> },
          { path: '/inventory/materials', element: <MaterialsPage /> },
          { path: '/inventory/movements', element: <MovementsPage /> },
          { path: '/procurement/suppliers', element: <SuppliersPage /> },
          { path: '/procurement/orders', element: <PurchaseOrdersPage /> },
          { path: '/procurement/orders/:id', element: <PODetailPage /> },
          { path: '/sales/customers', element: <CustomersPage /> },
          { path: '/sales/orders', element: <SalesPage /> },
          { path: '/sales/orders/:id', element: <SaleDetailPage /> },
          { path: '/finance/accounts', element: <AccountsPage /> },
          { path: '/finance/journal', element: <JournalPage /> },
          { path: '/finance/expenses', element: <ExpensesPage /> },
          { path: '/assets/register', element: <AssetsPage /> },
          { path: '/assets/maintenance', element: <MaintenancePage /> },
          { path: '/reports', element: <ReportsPage /> },
          { path: '/reports/production', element: <ProductionReportPage /> },
          { path: '/reports/sales', element: <SalesReportPage /> },
          { path: '/reports/profit-loss', element: <ProfitLossPage /> },
          {
            element: <AdminRoute />,
            children: [
              { path: '/settings/company', element: <CompanySettingsPage /> },
              { path: '/settings/users', element: <UsersPage /> },
              { path: '/settings/audit-log', element: <AuditLogPage /> },
            ],
          },
        ],
      },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
]);
