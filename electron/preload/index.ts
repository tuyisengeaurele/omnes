import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS, type AppApi } from '@shared/ipc';

const api: AppApi = {
  getAppVersion: () => ipcRenderer.invoke(IPC_CHANNELS.getAppVersion),
  checkDatabaseHealth: () => ipcRenderer.invoke(IPC_CHANNELS.checkDatabaseHealth),
  hasUsers: () => ipcRenderer.invoke(IPC_CHANNELS.hasUsers),
  createFirstAdmin: (username, password) =>
    ipcRenderer.invoke(IPC_CHANNELS.createFirstAdmin, username, password),
  login: (username, password) => ipcRenderer.invoke(IPC_CHANNELS.login, username, password),
  logout: () => ipcRenderer.invoke(IPC_CHANNELS.logout),
  unlock: (password) => ipcRenderer.invoke(IPC_CHANNELS.unlock, password),
  getSession: () => ipcRenderer.invoke(IPC_CHANNELS.getSession),
  getLastUsername: () => ipcRenderer.invoke(IPC_CHANNELS.getLastUsername),
  onSessionLocked: (callback) => {
    const listener = () => callback();
    ipcRenderer.on(IPC_CHANNELS.sessionLocked, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.sessionLocked, listener);
  },
  getLicenseInfo: () => ipcRenderer.invoke(IPC_CHANNELS.getLicenseInfo),
  createBackup: () => ipcRenderer.invoke(IPC_CHANNELS.createBackup),
  listBackups: () => ipcRenderer.invoke(IPC_CHANNELS.listBackups),
  verifyBackup: (id) => ipcRenderer.invoke(IPC_CHANNELS.verifyBackup, id),
  restoreBackup: (id) => ipcRenderer.invoke(IPC_CHANNELS.restoreBackup, id),
  revealBackupInFolder: (id) => ipcRenderer.invoke(IPC_CHANNELS.revealBackupInFolder, id),
};

contextBridge.exposeInMainWorld('omnes', api);
