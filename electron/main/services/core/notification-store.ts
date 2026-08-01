import Store from 'electron-store';
import type { NotificationRecord, NotificationSeverity } from '@shared/ipc';

interface NotificationStoreSchema {
  records: NotificationRecord[];
}

const store = new Store<NotificationStoreSchema>({
  name: 'notifications',
  defaults: { records: [] },
});

export function listNotificationRecords(): NotificationRecord[] {
  return store.get('records');
}

export interface NotificationInput {
  severity: NotificationSeverity;
  title: string;
  message: string;
}

export function addOrUpdateNotification(id: string, input: NotificationInput): NotificationRecord {
  const record: NotificationRecord = {
    id,
    severity: input.severity,
    title: input.title,
    message: input.message,
    createdAt: new Date().toISOString(),
    read: false,
  };
  const records = [record, ...store.get('records').filter((existing) => existing.id !== id)];
  store.set('records', records);
  return record;
}

export function markNotificationRead(id: string): void {
  const records = store.get('records');
  const index = records.findIndex((record) => record.id === id);
  if (index === -1) {
    return;
  }
  records[index] = { ...records[index], read: true };
  store.set('records', records);
}

export function markAllNotificationsRead(): void {
  const records = store.get('records').map((record) => ({ ...record, read: true }));
  store.set('records', records);
}

export function clearNotification(id: string): void {
  const records = store.get('records').filter((record) => record.id !== id);
  store.set('records', records);
}
