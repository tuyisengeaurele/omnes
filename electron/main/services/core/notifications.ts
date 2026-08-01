import { randomUUID } from 'node:crypto';
import type { BrowserWindow } from 'electron';
import log from 'electron-log/main';
import { IPC_CHANNELS } from '@shared/ipc';
import {
  addOrUpdateNotification,
  clearAllNotifications as clearAllNotificationRecords,
  clearNotification as clearNotificationRecord,
  listNotificationRecords,
  markAllNotificationsRead as markAllNotificationRecordsRead,
  markNotificationRead as markNotificationRecordRead,
} from './notification-store';
import type { NotificationRecord, NotificationSeverity } from '@shared/ipc';

let mainWindow: BrowserWindow | null = null;

export function registerMainWindow(window: BrowserWindow): void {
  mainWindow = window;
}

export interface NotifyInput {
  id?: string;
  severity: NotificationSeverity;
  title: string;
  message: string;
}

export function notify(input: NotifyInput): NotificationRecord | null {
  try {
    const record = addOrUpdateNotification(input.id ?? randomUUID(), {
      severity: input.severity,
      title: input.title,
      message: input.message,
    });
    mainWindow?.webContents.send(IPC_CHANNELS.notificationCreated, record);
    return record;
  } catch (error) {
    // A broken notification write must never crash the operation that
    // triggered it (e.g. a failed-backup notification must not itself
    // throw and mask the original backup failure it was reporting).
    log.error('Failed to create notification', error);
    return null;
  }
}

export function listNotifications(): NotificationRecord[] {
  return listNotificationRecords();
}

export function markNotificationRead(id: string): void {
  markNotificationRecordRead(id);
}

export function markAllNotificationsRead(): void {
  markAllNotificationRecordsRead();
}

export function clearNotification(id: string): void {
  clearNotificationRecord(id);
}

export function clearAllNotifications(): void {
  clearAllNotificationRecords();
}
