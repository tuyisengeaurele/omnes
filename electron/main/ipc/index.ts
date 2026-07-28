import { app, ipcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc';

export function registerIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.getAppVersion, () => app.getVersion());
}
