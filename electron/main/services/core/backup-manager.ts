import { app, shell } from 'electron';
import path from 'node:path';
import log from 'electron-log/main';
import { createBackup, isBackupDue, restoreBackup, verifyBackup } from './backup';
import {
  addBackupRecord,
  getBackupRecord,
  getMostRecentBackup,
  listBackupRecords,
  markBackupVerified,
} from './backup-store';
import { disconnectDatabase } from './database';
import type { BackupRecord, BackupResult } from '@shared/ipc';

function getBackupsDir(): string {
  return path.join(app.getPath('userData'), 'backups');
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function listBackups(): BackupRecord[] {
  return listBackupRecords();
}

export async function performManualBackup(): Promise<BackupResult> {
  try {
    const { filePath, sizeBytes } = await createBackup(getBackupsDir());
    const record = addBackupRecord(path.basename(filePath), sizeBytes);
    return { success: true, message: 'Backup created', record };
  } catch (error) {
    log.error('Backup failed', error);
    return { success: false, message: toErrorMessage(error), record: null };
  }
}

export async function performVerification(id: string): Promise<BackupResult> {
  const record = getBackupRecord(id);
  if (!record) {
    return { success: false, message: 'Backup not found', record: null };
  }

  const filePath = path.join(getBackupsDir(), record.filename);
  try {
    const isValid = await verifyBackup(filePath);
    const updated = markBackupVerified(id, isValid);
    return {
      success: isValid,
      message: isValid ? 'Backup verified successfully' : 'Backup verification failed',
      record: updated,
    };
  } catch (error) {
    log.error('Backup verification failed', error);
    markBackupVerified(id, false);
    return { success: false, message: toErrorMessage(error), record: null };
  }
}

export async function performRestore(id: string): Promise<BackupResult> {
  const record = getBackupRecord(id);
  if (!record) {
    return { success: false, message: 'Backup not found', record: null };
  }

  const filePath = path.join(getBackupsDir(), record.filename);
  try {
    await disconnectDatabase();
    await restoreBackup(filePath);
    return { success: true, message: 'Restore completed', record };
  } catch (error) {
    log.error('Restore failed', error);
    return { success: false, message: toErrorMessage(error), record: null };
  }
}

export function revealBackupInFolder(id: string): void {
  const record = getBackupRecord(id);
  if (!record) {
    return;
  }
  shell.showItemInFolder(path.join(getBackupsDir(), record.filename));
}

export async function performScheduledBackupIfDue(): Promise<void> {
  const latest = getMostRecentBackup();
  if (!isBackupDue(latest?.createdAt ?? null)) {
    return;
  }

  const result = await performManualBackup();
  if (result.success) {
    log.info('Scheduled backup completed', result.record?.filename);
  } else {
    log.error('Scheduled backup failed', result.message);
  }
}
