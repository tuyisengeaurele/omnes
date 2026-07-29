import { BrowserWindow, powerMonitor } from 'electron';
import log from 'electron-log/main';
import { IPC_CHANNELS } from '@shared/ipc';
import { getSession, lockSession } from './auth';

const IDLE_THRESHOLD_SECONDS = 300;
const POLL_INTERVAL_MS = 30_000;

export function startIdleMonitor(window: BrowserWindow): NodeJS.Timeout {
  return setInterval(() => {
    const session = getSession();
    if (!session || session.isLocked) return;

    if (powerMonitor.getSystemIdleTime() >= IDLE_THRESHOLD_SECONDS) {
      lockSession()
        .then(() => {
          window.webContents.send(IPC_CHANNELS.sessionLocked);
        })
        .catch((error: unknown) => {
          log.error('Failed to lock session after idle timeout', error);
        });
    }
  }, POLL_INTERVAL_MS);
}
