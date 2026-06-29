import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '@/features/auth/AuthContext';
import { cn } from '@/lib/utils';
import { getInitials } from '@/lib/utils';
import {
  LayoutDashboard, Users, Building2, Calendar, FileText, DollarSign,
  Package, Flame, ShoppingCart, Truck, BarChart3, BookOpen, CreditCard,
  Wrench, Boxes, ChevronDown, ChevronRight, Menu, X, LogOut,
  Factory, ClipboardList, Settings, Shield, Eye,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/axios';

interface NavItem {
  label: string;
  href?: string;
  icon: React.ElementType;
  children?: NavItem[];
  adminOnly?: boolean;
}

const navItems: NavItem[] = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  {
    label: 'Human Resources', icon: Users,
    children: [
      { label: 'Employees', href: '/hr/employees', icon: Users },
      { label: 'Departments', href: '/hr/departments', icon: Building2 },
      { label: 'Attendance', href: '/hr/attendance', icon: Calendar },
      { label: 'Leave Requests', href: '/hr/leave', icon: FileText },
      { label: 'Payroll', href: '/hr/payroll', icon: DollarSign },
    ],
  },
  {
    label: 'Production', icon: Factory,
    children: [
      { label: 'Batches', href: '/production/batches', icon: Flame },
      { label: 'Kilns', href: '/production/kilns', icon: Factory },
      { label: 'Product Types', href: '/production/products', icon: Package },
    ],
  },
  {
    label: 'Inventory', icon: Boxes,
    children: [
      { label: 'Raw Materials', href: '/inventory/materials', icon: Boxes },
      { label: 'Stock Movements', href: '/inventory/movements', icon: ClipboardList },
    ],
  },
  {
    label: 'Procurement', icon: ShoppingCart,
    children: [
      { label: 'Suppliers', href: '/procurement/suppliers', icon: Truck },
      { label: 'Purchase Orders', href: '/procurement/orders', icon: ShoppingCart },
    ],
  },
  {
    label: 'Sales', icon: BarChart3,
    children: [
      { label: 'Customers', href: '/sales/customers', icon: Users },
      { label: 'Sales & Invoices', href: '/sales/orders', icon: FileText },
    ],
  },
  {
    label: 'Finance', icon: CreditCard,
    children: [
      { label: 'Chart of Accounts', href: '/finance/accounts', icon: BookOpen },
      { label: 'Journal Entries', href: '/finance/journal', icon: FileText },
      { label: 'Expenses', href: '/finance/expenses', icon: DollarSign },
    ],
  },
  {
    label: 'Assets', icon: Wrench,
    children: [
      { label: 'Fixed Assets', href: '/assets/register', icon: Wrench },
      { label: 'Maintenance', href: '/assets/maintenance', icon: Settings },
    ],
  },
  { label: 'Reports', href: '/reports', icon: BarChart3 },
  {
    label: 'Settings', icon: Settings, adminOnly: true,
    children: [
      { label: 'Company Profile', href: '/settings/company', icon: Building2 },
      { label: 'Users', href: '/settings/users', icon: Shield },
      { label: 'Audit Log', href: '/settings/audit-log', icon: Eye },
    ],
  },
];

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

function NavItemRow({ item, depth = 0, collapsed }: { item: NavItem; depth?: number; collapsed: boolean }) {
  const location = useLocation();
  const [open, setOpen] = useState(() => {
    if (!item.children) return false;
    return item.children.some((c) => c.href && location.pathname.startsWith(c.href));
  });
  const { user } = useAuth();

  if (item.adminOnly && user?.role !== 'ADMIN') return null;

  if (item.href) {
    return (
      <NavLink
        to={item.href}
        className={({ isActive }) =>
          cn(
            'flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-colors relative group',
            depth > 0 && 'ml-4 pl-4',
            isActive
              ? 'bg-primary/15 text-primary font-medium border-l-2 border-primary -ml-0'
              : 'text-slate-300 hover:bg-white/10 hover:text-white',
            collapsed && depth === 0 && 'justify-center px-2'
          )
        }
        title={collapsed ? item.label : undefined}
      >
        <item.icon className="h-4 w-4 shrink-0" />
        {!collapsed && <span className="truncate">{item.label}</span>}
      </NavLink>
    );
  }

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          'w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm text-slate-300 hover:bg-white/10 hover:text-white transition-colors',
          collapsed && 'justify-center px-2'
        )}
        title={collapsed ? item.label : undefined}
      >
        <item.icon className="h-4 w-4 shrink-0" />
        {!collapsed && (
          <>
            <span className="truncate flex-1 text-left">{item.label}</span>
            {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </>
        )}
      </button>
      {open && !collapsed && (
        <div className="mt-0.5 space-y-0.5">
          {item.children?.map((child) => (
            <NavItemRow key={child.label} item={child} depth={depth + 1} collapsed={collapsed} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const { user, logout } = useAuth();
  const { data: logoData } = useQuery({
    queryKey: ['logo'],
    queryFn: async () => {
      const res = await api.get('/public/logo');
      return res.data.data.logo as string;
    },
    staleTime: Infinity,
    retry: false,
  });

  return (
    <aside
      className={cn(
        'flex flex-col h-screen bg-dark text-white transition-all duration-300 shrink-0',
        collapsed ? 'w-16' : 'w-64'
      )}
    >
      <div className={cn('flex items-center gap-3 p-4 border-b border-white/10', collapsed && 'justify-center')}>
        {logoData ? (
          <img src={logoData} alt="OMNES" className="h-8 w-8 object-contain rounded" />
        ) : (
          <div className="h-8 w-8 rounded bg-primary flex items-center justify-center text-xs font-bold">O</div>
        )}
        {!collapsed && (
          <div>
            <div className="font-bold text-sm leading-tight">OMNES ERP</div>
            <div className="text-xs text-slate-400 leading-tight">Manufacturing</div>
          </div>
        )}
        <button onClick={onToggle} className="ml-auto p-1 rounded hover:bg-white/10 transition-colors">
          {collapsed ? <Menu className="h-4 w-4" /> : <X className="h-4 w-4" />}
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto py-4 px-2 space-y-0.5">
        {navItems.map((item, i) => (
          <div key={i}>
            {i > 0 && i % 1 === 0 && item.label === 'Production' && <Separator className="my-2 bg-white/10" />}
            {item.label === 'Inventory' && <Separator className="my-2 bg-white/10" />}
            {item.label === 'Procurement' && <Separator className="my-2 bg-white/10" />}
            {item.label === 'Sales' && <Separator className="my-2 bg-white/10" />}
            {item.label === 'Finance' && <Separator className="my-2 bg-white/10" />}
            {item.label === 'Assets' && <Separator className="my-2 bg-white/10" />}
            {item.label === 'Reports' && <Separator className="my-2 bg-white/10" />}
            {item.label === 'Settings' && <Separator className="my-2 bg-white/10" />}
            <NavItemRow item={item} collapsed={collapsed} />
          </div>
        ))}
      </nav>

      {user && (
        <div className={cn('p-4 border-t border-white/10', collapsed && 'flex flex-col items-center gap-2')}>
          {!collapsed ? (
            <div className="flex items-center gap-3">
              <div className="h-8 w-8 rounded-full bg-primary flex items-center justify-center text-xs font-bold shrink-0">
                {getInitials(user.firstName, user.lastName)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{user.firstName} {user.lastName}</div>
                <div className="text-xs text-slate-400 truncate">{user.role}</div>
              </div>
              <Button variant="ghost" size="icon" onClick={logout} className="text-slate-400 hover:text-white hover:bg-white/10 h-8 w-8">
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <>
              <div className="h-8 w-8 rounded-full bg-primary flex items-center justify-center text-xs font-bold">
                {getInitials(user.firstName, user.lastName)}
              </div>
              <Button variant="ghost" size="icon" onClick={logout} className="text-slate-400 hover:text-white hover:bg-white/10 h-7 w-7">
                <LogOut className="h-3.5 w-3.5" />
              </Button>
            </>
          )}
        </div>
      )}
    </aside>
  );
}
