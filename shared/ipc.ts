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
}
