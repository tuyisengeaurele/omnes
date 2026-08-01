import 'dotenv/config';
import { app, BrowserWindow, session, shell } from 'electron';
import { join } from 'node:path';
import log from 'electron-log/main';
import { registerIpcHandlers } from './ipc';
import { startBackupScheduler } from './services/core/backup-scheduler';
import { disconnectDatabase } from './services/core/database';
import { startIdleMonitor } from './services/core/idle';

const isDev = !app.isPackaged;
const dirname = import.meta.dirname;

log.initialize();
log.transports.file.level = 'info';
log.transports.file.maxSize = 5 * 1024 * 1024;

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0b0d12',
    webPreferences: {
      preload: join(dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.once('ready-to-show', () => {
    window.show();
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void window.loadFile(join(dirname, '../renderer/index.html'));
  }

  return window;
}

void app.whenReady().then(() => {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:;",
        ],
      },
    });
  });

  registerIpcHandlers();
  const mainWindow = createMainWindow();
  startIdleMonitor(mainWindow);
  startBackupScheduler();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  disconnectDatabase().catch((error: unknown) => {
    log.error('Failed to disconnect database cleanly', error);
  });
});

process.on('uncaughtException', (error) => {
  log.error('Uncaught exception', error);
});

process.on('unhandledRejection', (reason) => {
  log.error('Unhandled rejection', reason);
});
