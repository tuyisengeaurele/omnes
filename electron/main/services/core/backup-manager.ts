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
import { getSession } from './auth';
import { disconnectDatabase } from './database';
import type { BackupRecord, BackupResult } from '@shared/ipc';

function getBackupsDir(): string {
  return path.join(app.getPath('userData'), 'backups');
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// createBackup, verifyBackup, and restoreBackup all touch either the live
// database or the shared omnes_backup_verify scratch database — running two
// of them at once (e.g. two "Verify" clicks, or a restore while a backup is
// in progress) races on that shared state. This flag serializes them.
let operationInProgress = false;

async function withExclusiveLock(operation: () => Promise<BackupResult>): Promise<BackupResult> {
  if (operationInProgress) {
    return {
      success: false,
      message: 'Another backup operation is already in progress. Try again shortly.',
      record: null,
    };
  }
  operationInProgress = true;
  try {
    return await operation();
  } finally {
    operationInProgress = false;
  }
}

export function listBackups(): BackupRecord[] {
  return listBackupRecords();
}

export function performManualBackup(): Promise<BackupResult> {
  return withExclusiveLock(async () => {
    try {
      const { filePath, sizeBytes } = await createBackup(getBackupsDir());
      const record = addBackupRecord(path.basename(filePath), sizeBytes);
      return { success: true, message: 'Backup created', record };
    } catch (error) {
      log.error('Backup failed', error);
      return { success: false, message: toErrorMessage(error), record: null };
    }
  });
}

export function performVerification(id: string): Promise<BackupResult> {
  return withExclusiveLock(async () => {
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
  });
}

export function performRestore(id: string): Promise<BackupResult> {
  return withExclusiveLock(async () => {
    if (getSession()?.role !== 'ADMIN') {
      return {
        success: false,
        message: 'Only an administrator can restore a backup',
        record: null,
      };
    }

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
  });
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
