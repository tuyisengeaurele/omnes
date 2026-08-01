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
}
