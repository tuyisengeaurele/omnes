import { performScheduledBackupIfDue } from './backup-manager';

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

export function startBackupScheduler(): NodeJS.Timeout {
  void performScheduledBackupIfDue();

  return setInterval(() => {
    void performScheduledBackupIfDue();
  }, CHECK_INTERVAL_MS);
}
