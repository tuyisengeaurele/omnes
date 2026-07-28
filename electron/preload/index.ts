import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS, type AppApi } from '@shared/ipc';

const api: AppApi = {
  getAppVersion: () => ipcRenderer.invoke(IPC_CHANNELS.getAppVersion),
  checkDatabaseHealth: () => ipcRenderer.invoke(IPC_CHANNELS.checkDatabaseHealth),
};

contextBridge.exposeInMainWorld('omnes', api);
