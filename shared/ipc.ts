export const IPC_CHANNELS = {
  getAppVersion: 'app:get-version',
  checkDatabaseHealth: 'database:health-check',
  hasUsers: 'auth:has-users',
  createFirstAdmin: 'auth:create-first-admin',
  login: 'auth:login',
  logout: 'auth:logout',
  unlock: 'auth:unlock',
  getSession: 'auth:get-session',
  getLastUsername: 'auth:get-last-username',
  sessionLocked: 'session:locked',
  getLicenseInfo: 'license:get-info',
  createBackup: 'backup:create',
  listBackups: 'backup:list',
  verifyBackup: 'backup:verify',
  restoreBackup: 'backup:restore',
  revealBackupInFolder: 'backup:reveal-in-folder',
  listNotifications: 'notification:list',
  markNotificationRead: 'notification:mark-read',
  markAllNotificationsRead: 'notification:mark-all-read',
  clearNotification: 'notification:clear',
  clearAllNotifications: 'notification:clear-all',
  notificationCreated: 'notification:created',
  listProducts: 'product:list',
  createProduct: 'product:create',
  updateProduct: 'product:update',
  setProductActive: 'product:set-active',
  createSale: 'sale:create',
  listSales: 'sale:list',
  getSale: 'sale:get',
  listUsers: 'user:list',
  createUser: 'user:create',
  setUserRole: 'user:set-role',
  setUserActive: 'user:set-active',
  resetUserPassword: 'user:reset-password',
  getSalesSummary: 'reports:get-summary',
  getTopProducts: 'reports:get-top-products',
  listCustomers: 'customer:list',
  createCustomer: 'customer:create',
  updateCustomer: 'customer:update',
  setCustomerActive: 'customer:set-active',
} as const;

export interface DatabaseHealthResult {
  connected: boolean;
}

export type Role = 'ADMIN' | 'MANAGER' | 'CASHIER';

export interface Session {
  userId: string;
  username: string;
  role: Role;
  loginAt: string;
  isLocked: boolean;
}

export type LicenseTier = 'DEVELOPMENT' | 'BASE';

export type Feature =
  | 'pos'
  | 'inventory'
  | 'receipts'
  | 'reports_basic'
  | 'administration'
  | 'mobile_money'
  | 'crm'
  | 'loyalty'
  | 'store_credit'
  | 'reports_advanced'
  | 'multi_warehouse';

export interface LicenseInfo {
  licenseId: string;
  customerName: string | null;
  tier: LicenseTier;
  addons: Feature[];
  issuedAt: string;
  expiresAt: string | null;
}

export interface BackupRecord {
  id: string;
  filename: string;
  createdAt: string;
  sizeBytes: number;
  verified: boolean;
  verifiedAt: string | null;
}

export interface BackupResult {
  success: boolean;
  message: string;
  record: BackupRecord | null;
}

export type NotificationSeverity = 'info' | 'warning' | 'error';

export interface NotificationRecord {
  id: string;
  severity: NotificationSeverity;
  title: string;
  message: string;
  createdAt: string;
  read: boolean;
}

export interface Product {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  category: string;
  price: number;
  stockQuantity: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProductInput {
  name: string;
  sku: string;
  barcode: string | null;
  category: string;
  price: number;
  stockQuantity: number;
}

export interface ProductResult {
  success: boolean;
  message: string;
  product: Product | null;
}

export type PaymentMethod = 'CASH' | 'MOBILE_MONEY';

export interface SaleItem {
  id: string;
  productId: string | null;
  productName: string;
  unitPrice: number;
  quantity: number;
}

export interface Sale {
  id: string;
  cashierUsername: string | null;
  customerId: string | null;
  customerName: string | null;
  paymentMethod: PaymentMethod;
  amountTendered: number | null;
  changeGiven: number | null;
  total: number;
  createdAt: string;
  items: SaleItem[];
}

export interface SaleLineInput {
  productId: string;
  quantity: number;
}

export interface CreateSaleInput {
  items: SaleLineInput[];
  paymentMethod: PaymentMethod;
  amountTendered: number | null;
  customerId?: string | null;
}

export interface SaleResult {
  success: boolean;
  message: string;
  sale: Sale | null;
}

export interface ManagedUser {
  id: string;
  username: string;
  role: Role;
  isActive: boolean;
  createdAt: string;
}

export interface UserResult {
  success: boolean;
  message: string;
  user: ManagedUser | null;
}

export type ReportRange = 'TODAY' | 'THIS_WEEK' | 'THIS_MONTH' | 'ALL_TIME';

export interface SalesSummary {
  totalRevenue: number;
  transactionCount: number;
  averageSale: number;
  cashTotal: number;
  mobileMoneyTotal: number;
}

export interface TopProduct {
  productName: string;
  quantitySold: number;
  revenue: number;
}

export interface Customer {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerInput {
  name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
}

export interface CustomerResult {
  success: boolean;
  message: string;
  customer: Customer | null;
}

export interface AppApi {
  getAppVersion: () => Promise<string>;
  checkDatabaseHealth: () => Promise<DatabaseHealthResult>;
  hasUsers: () => Promise<boolean>;
  createFirstAdmin: (username: string, password: string) => Promise<Session>;
  login: (username: string, password: string) => Promise<Session>;
  logout: () => Promise<void>;
  unlock: (password: string) => Promise<Session>;
  getSession: () => Promise<Session | null>;
  getLastUsername: () => Promise<string | null>;
  onSessionLocked: (callback: () => void) => () => void;
  getLicenseInfo: () => Promise<LicenseInfo>;
  createBackup: () => Promise<BackupResult>;
  listBackups: () => Promise<BackupRecord[]>;
  verifyBackup: (id: string) => Promise<BackupResult>;
  restoreBackup: (id: string) => Promise<BackupResult>;
  revealBackupInFolder: (id: string) => Promise<void>;
  listNotifications: () => Promise<NotificationRecord[]>;
  markNotificationRead: (id: string) => Promise<void>;
  markAllNotificationsRead: () => Promise<void>;
  clearNotification: (id: string) => Promise<void>;
  clearAllNotifications: () => Promise<void>;
  onNotificationCreated: (callback: (notification: NotificationRecord) => void) => () => void;
  listProducts: (includeInactive?: boolean) => Promise<Product[]>;
  createProduct: (input: ProductInput) => Promise<ProductResult>;
  updateProduct: (id: string, input: Partial<ProductInput>) => Promise<ProductResult>;
  setProductActive: (id: string, isActive: boolean) => Promise<ProductResult>;
  createSale: (input: CreateSaleInput) => Promise<SaleResult>;
  listSales: (customerId?: string) => Promise<Sale[]>;
  getSale: (id: string) => Promise<Sale | null>;
  listUsers: () => Promise<ManagedUser[]>;
  createUser: (username: string, password: string, role: Role) => Promise<UserResult>;
  setUserRole: (id: string, role: Role) => Promise<UserResult>;
  setUserActive: (id: string, isActive: boolean) => Promise<UserResult>;
  resetUserPassword: (id: string, newPassword: string) => Promise<UserResult>;
  getSalesSummary: (range: ReportRange) => Promise<SalesSummary>;
  getTopProducts: (range: ReportRange, limit?: number) => Promise<TopProduct[]>;
  listCustomers: (includeInactive?: boolean) => Promise<Customer[]>;
  createCustomer: (input: CustomerInput) => Promise<CustomerResult>;
  updateCustomer: (id: string, input: Partial<CustomerInput>) => Promise<CustomerResult>;
  setCustomerActive: (id: string, isActive: boolean) => Promise<CustomerResult>;
}
