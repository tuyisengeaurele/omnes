import { randomUUID } from 'node:crypto';
import Store from 'electron-store';
import type { BackupRecord } from '@shared/ipc';

interface BackupStoreSchema {
  records: BackupRecord[];
}

const store = new Store<BackupStoreSchema>({ name: 'backups', defaults: { records: [] } });

export function listBackupRecords(): BackupRecord[] {
  return store.get('records');
}

export function getBackupRecord(id: string): BackupRecord | null {
  return store.get('records').find((record) => record.id === id) ?? null;
}

export function getMostRecentBackup(): BackupRecord | null {
  return listBackupRecords()[0] ?? null;
}

export function addBackupRecord(filename: string, sizeBytes: number): BackupRecord {
  const record: BackupRecord = {
    id: randomUUID(),
    filename,
    createdAt: new Date().toISOString(),
    sizeBytes,
    verified: false,
    verifiedAt: null,
  };
  const records = [record, ...store.get('records')];
  store.set('records', records);
  return record;
}

export function markBackupVerified(id: string, verified: boolean): BackupRecord | null {
  const records = store.get('records');
  const index = records.findIndex((record) => record.id === id);
  if (index === -1) {
    return null;
  }
  const updated: BackupRecord = {
    ...records[index],
    verified,
    verifiedAt: new Date().toISOString(),
  };
  records[index] = updated;
  store.set('records', records);
  return updated;
}
