import { app, ipcMain } from 'electron';
import log from 'electron-log/main';
import {
  IPC_CHANNELS,
  type BackupRecord,
  type BackupResult,
  type DatabaseHealthResult,
  type LicenseInfo,
  type Session,
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
}
