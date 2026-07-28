import { app, ipcMain } from 'electron';
import { IPC_CHANNELS, type DatabaseHealthResult } from '@shared/ipc';
import { checkDatabaseHealth } from '../services/core/database';

export function registerIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.getAppVersion, () => app.getVersion());

  ipcMain.handle(IPC_CHANNELS.checkDatabaseHealth, async (): Promise<DatabaseHealthResult> => {
    const connected = await checkDatabaseHealth();
    return { connected };
  });
}
