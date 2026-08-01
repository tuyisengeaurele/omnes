// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  isBackupDue,
  locatePgDump,
  locatePgRestore,
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
