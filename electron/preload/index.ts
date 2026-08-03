import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS, type AppApi, type NotificationRecord } from '@shared/ipc';

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
  listNotifications: () => ipcRenderer.invoke(IPC_CHANNELS.listNotifications),
  markNotificationRead: (id) => ipcRenderer.invoke(IPC_CHANNELS.markNotificationRead, id),
  markAllNotificationsRead: () => ipcRenderer.invoke(IPC_CHANNELS.markAllNotificationsRead),
  clearNotification: (id) => ipcRenderer.invoke(IPC_CHANNELS.clearNotification, id),
  clearAllNotifications: () => ipcRenderer.invoke(IPC_CHANNELS.clearAllNotifications),
  onNotificationCreated: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, notification: NotificationRecord) =>
      callback(notification);
    ipcRenderer.on(IPC_CHANNELS.notificationCreated, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.notificationCreated, listener);
  },
  listProducts: (includeInactive) => ipcRenderer.invoke(IPC_CHANNELS.listProducts, includeInactive),
  createProduct: (input) => ipcRenderer.invoke(IPC_CHANNELS.createProduct, input),
  updateProduct: (id, input) => ipcRenderer.invoke(IPC_CHANNELS.updateProduct, id, input),
  setProductActive: (id, isActive) =>
    ipcRenderer.invoke(IPC_CHANNELS.setProductActive, id, isActive),
  createSale: (input) => ipcRenderer.invoke(IPC_CHANNELS.createSale, input),
  listSales: () => ipcRenderer.invoke(IPC_CHANNELS.listSales),
  getSale: (id) => ipcRenderer.invoke(IPC_CHANNELS.getSale, id),
  listUsers: () => ipcRenderer.invoke(IPC_CHANNELS.listUsers),
  createUser: (username, password, role) =>
    ipcRenderer.invoke(IPC_CHANNELS.createUser, username, password, role),
  setUserRole: (id, role) => ipcRenderer.invoke(IPC_CHANNELS.setUserRole, id, role),
  setUserActive: (id, isActive) => ipcRenderer.invoke(IPC_CHANNELS.setUserActive, id, isActive),
  resetUserPassword: (id, newPassword) =>
    ipcRenderer.invoke(IPC_CHANNELS.resetUserPassword, id, newPassword),
};

contextBridge.exposeInMainWorld('omnes', api);
