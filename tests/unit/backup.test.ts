// @vitest-environment node
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  createBackup,
  isBackupDue,
  locatePgDump,
  locatePgRestore,
  verifyBackup,
} from '../../electron/main/services/core/backup';

describe('isBackupDue', () => {
  it('is due when no backup has ever been taken', () => {
    expect(isBackupDue(null)).toBe(true);
  });

  it('is not due when the last backup was recent', () => {
    expect(isBackupDue(new Date().toISOString())).toBe(false);
  });

  it('is due when the last backup was more than 24 hours ago', () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    expect(isBackupDue(twoDaysAgo)).toBe(true);
  });

  it('is not due exactly at the 24 hour boundary minus a second', () => {
    const almostADayAgo = new Date(Date.now() - (24 * 60 * 60 * 1000 - 1000)).toISOString();
    expect(isBackupDue(almostADayAgo)).toBe(false);
  });
});

describe('locatePgDump and locatePgRestore', () => {
  it('finds real pg_dump and pg_restore binaries on this machine', async () => {
    const pgDumpPath = await locatePgDump();
    const pgRestorePath = await locatePgRestore();

    expect(pgDumpPath).toBeTruthy();
    expect(pgRestorePath).toBeTruthy();
  }, 15_000);
});

describe('createBackup and verifyBackup', () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'omnes-backup-test-'));

  afterAll(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('creates a real pg_dump archive and verifies it restores cleanly', async () => {
    const { filePath, sizeBytes } = await createBackup(tempDir);

    expect(existsSync(filePath)).toBe(true);
    expect(sizeBytes).toBeGreaterThan(0);

    const isValid = await verifyBackup(filePath);
    expect(isValid).toBe(true);
  }, 30_000);

  it('reports a truncated file as invalid rather than throwing', async () => {
    const { filePath, sizeBytes } = await createBackup(tempDir);
    const fs = await import('node:fs');
    // Custom-format archives tolerate trailing garbage, so truncation (which
    // breaks the internal TOC/data structure) is what actually makes
    // pg_restore fail, unlike appending bytes after a valid archive.
    fs.truncateSync(filePath, Math.floor(sizeBytes / 2));

    const isValid = await verifyBackup(filePath);
    expect(isValid).toBe(false);
  }, 30_000);
});
