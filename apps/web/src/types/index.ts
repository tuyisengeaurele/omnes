export type UserRole =
  | 'ADMIN'
  | 'MANAGER'
  | 'ACCOUNTANT'
  | 'HR_OFFICER'
  | 'PRODUCTION_SUPERVISOR'
  | 'SALES_OFFICER'
  | 'VIEWER';

export interface AuthUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  isActive: boolean;
  lastLoginAt: string | null;
}

export interface PaginatedResponse<T> {
  success: boolean;
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

export interface CompanySettings {
  id: string;
  name: string;
  tinNumber: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  website: string | null;
  logoPath: string | null;
  currency: string;
  vatRate: number;
  financialYearStart: number;
}

export type EmployeeStatus = 'ACTIVE' | 'ON_LEAVE' | 'SUSPENDED' | 'TERMINATED';
export type ContractType = 'PERMANENT' | 'CONTRACT' | 'CASUAL' | 'INTERN';
export type Gender = 'MALE' | 'FEMALE';
export type LeaveType = 'ANNUAL' | 'SICK' | 'MATERNITY' | 'PATERNITY' | 'UNPAID' | 'OTHER';
export type LeaveStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
export type BatchStatus = 'PLANNED' | 'IN_PROGRESS' | 'FIRED' | 'COMPLETED' | 'REJECTED';
export type MovementType = 'IN' | 'OUT' | 'ADJUSTMENT';
export type POStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'RECEIVED' | 'CANCELLED';
export type SaleStatus = 'PROFORMA' | 'CONFIRMED' | 'DELIVERED' | 'INVOICED' | 'PAID' | 'CANCELLED';
export type PaymentStatus = 'UNPAID' | 'PARTIAL' | 'PAID';
export type CustomerType = 'INDIVIDUAL' | 'COMPANY';
export type AccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';
export type AssetStatus = 'ACTIVE' | 'UNDER_MAINTENANCE' | 'DISPOSED' | 'IDLE';
export type MaintenanceStatus = 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
