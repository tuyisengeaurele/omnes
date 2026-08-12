import { app, ipcMain } from 'electron';
import log from 'electron-log/main';
import {
  IPC_CHANNELS,
  type BackupRecord,
  type BackupResult,
  type CreateSaleInput,
  type Customer,
  type CustomerInput,
  type CustomerResult,
  type DatabaseHealthResult,
  type LicenseInfo,
  type ManagedUser,
  type NotificationRecord,
  type Product,
  type ProductInput,
  type ProductResult,
  type ReportRange,
  type Role,
  type Sale,
  type SaleResult,
  type SalesSummary,
  type Session,
  type TopProduct,
  type UserResult,
} from '@shared/ipc';
import {
  listBackups,
  performManualBackup,
  performRestore,
  performVerification,
  revealBackupInFolder,
} from '../services/core/backup-manager';
import { checkDatabaseHealth } from '../services/core/database';
import {
  createFirstAdmin,
  getSession,
  hasUsers,
  login,
  logout,
  unlock,
} from '../services/core/auth';
import { getLastUsername, setLastUsername } from '../services/core/preferences';
import { getActiveLicense } from '../services/core/license-store';
import {
  clearAllNotifications,
  clearNotification,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '../services/core/notifications';
import {
  createProduct,
  listProducts,
  setProductActive,
  updateProduct,
} from '../services/core/products';
import { createSale, getSale, listSales } from '../services/core/sales';
import {
  createUser,
  listUsers,
  resetUserPassword,
  setUserActive,
  setUserRole,
} from '../services/core/users';
import { getSalesSummary, getTopProducts } from '../services/core/reports';
import {
  createCustomer,
  listCustomers,
  setCustomerActive,
  updateCustomer,
} from '../services/core/customers';

export function registerIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.getAppVersion, () => app.getVersion());

  ipcMain.handle(IPC_CHANNELS.checkDatabaseHealth, async (): Promise<DatabaseHealthResult> => {
    const connected = await checkDatabaseHealth();
    return { connected };
  });

  ipcMain.handle(IPC_CHANNELS.hasUsers, () => hasUsers());

  ipcMain.handle(
    IPC_CHANNELS.createFirstAdmin,
    async (_event, username: string, password: string): Promise<Session> => {
      const session = await createFirstAdmin(username, password);
      setLastUsername(session.username);
      return session;
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.login,
    async (_event, username: string, password: string): Promise<Session> => {
      const session = await login(username, password);
      setLastUsername(session.username);
      return session;
    },
  );

  ipcMain.handle(IPC_CHANNELS.logout, () => logout());

  ipcMain.handle(IPC_CHANNELS.unlock, async (_event, password: string): Promise<Session> => {
    try {
      return await unlock(password);
    } catch (error) {
      log.warn('Unlock attempt failed', error);
      throw error;
    }
  });

  ipcMain.handle(IPC_CHANNELS.getSession, (): Session | null => getSession());

  ipcMain.handle(IPC_CHANNELS.getLastUsername, (): string | null => getLastUsername());

  ipcMain.handle(IPC_CHANNELS.getLicenseInfo, (): LicenseInfo => getActiveLicense());

  ipcMain.handle(IPC_CHANNELS.createBackup, (): Promise<BackupResult> => performManualBackup());

  ipcMain.handle(IPC_CHANNELS.listBackups, (): BackupRecord[] => listBackups());

  ipcMain.handle(IPC_CHANNELS.verifyBackup, (_event, id: string): Promise<BackupResult> =>
    performVerification(id),
  );

  ipcMain.handle(IPC_CHANNELS.restoreBackup, (_event, id: string): Promise<BackupResult> =>
    performRestore(id),
  );

  ipcMain.handle(IPC_CHANNELS.revealBackupInFolder, (_event, id: string): void =>
    revealBackupInFolder(id),
  );

  ipcMain.handle(IPC_CHANNELS.listNotifications, (): NotificationRecord[] => listNotifications());

  ipcMain.handle(IPC_CHANNELS.markNotificationRead, (_event, id: string): void =>
    markNotificationRead(id),
  );

  ipcMain.handle(IPC_CHANNELS.markAllNotificationsRead, (): void => markAllNotificationsRead());

  ipcMain.handle(IPC_CHANNELS.clearNotification, (_event, id: string): void =>
    clearNotification(id),
  );

  ipcMain.handle(IPC_CHANNELS.clearAllNotifications, (): void => clearAllNotifications());

  ipcMain.handle(
    IPC_CHANNELS.listProducts,
    (_event, includeInactive?: boolean): Promise<Product[]> => listProducts(includeInactive),
  );

  ipcMain.handle(
    IPC_CHANNELS.createProduct,
    (_event, input: ProductInput): Promise<ProductResult> => createProduct(input),
  );

  ipcMain.handle(
    IPC_CHANNELS.updateProduct,
    (_event, id: string, input: Partial<ProductInput>): Promise<ProductResult> =>
      updateProduct(id, input),
  );

  ipcMain.handle(
    IPC_CHANNELS.setProductActive,
    (_event, id: string, isActive: boolean): Promise<ProductResult> =>
      setProductActive(id, isActive),
  );

  ipcMain.handle(IPC_CHANNELS.createSale, (_event, input: CreateSaleInput): Promise<SaleResult> =>
    createSale(input),
  );

  ipcMain.handle(IPC_CHANNELS.listSales, (_event, customerId?: string): Promise<Sale[]> =>
    listSales(customerId),
  );

  ipcMain.handle(IPC_CHANNELS.getSale, (_event, id: string): Promise<Sale | null> => getSale(id));

  ipcMain.handle(IPC_CHANNELS.listUsers, (): Promise<ManagedUser[]> => listUsers());

  ipcMain.handle(
    IPC_CHANNELS.createUser,
    (_event, username: string, password: string, role: Role): Promise<UserResult> =>
      createUser(username, password, role),
  );

  ipcMain.handle(IPC_CHANNELS.setUserRole, (_event, id: string, role: Role): Promise<UserResult> =>
    setUserRole(id, role),
  );

  ipcMain.handle(
    IPC_CHANNELS.setUserActive,
    (_event, id: string, isActive: boolean): Promise<UserResult> => setUserActive(id, isActive),
  );

  ipcMain.handle(
    IPC_CHANNELS.resetUserPassword,
    (_event, id: string, newPassword: string): Promise<UserResult> =>
      resetUserPassword(id, newPassword),
  );

  ipcMain.handle(
    IPC_CHANNELS.getSalesSummary,
    (_event, range: ReportRange): Promise<SalesSummary> => getSalesSummary(range),
  );

  ipcMain.handle(
    IPC_CHANNELS.getTopProducts,
    (_event, range: ReportRange, limit?: number): Promise<TopProduct[]> =>
      getTopProducts(range, limit),
  );

  ipcMain.handle(
    IPC_CHANNELS.listCustomers,
    (_event, includeInactive?: boolean): Promise<Customer[]> => listCustomers(includeInactive),
  );

  ipcMain.handle(
    IPC_CHANNELS.createCustomer,
    (_event, input: CustomerInput): Promise<CustomerResult> => createCustomer(input),
  );

  ipcMain.handle(
    IPC_CHANNELS.updateCustomer,
    (_event, id: string, input: Partial<CustomerInput>): Promise<CustomerResult> =>
      updateCustomer(id, input),
  );

  ipcMain.handle(
    IPC_CHANNELS.setCustomerActive,
    (_event, id: string, isActive: boolean): Promise<CustomerResult> =>
      setCustomerActive(id, isActive),
  );
}
