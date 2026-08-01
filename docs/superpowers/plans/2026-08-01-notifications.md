# Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A general in-app notification system (titlebar bell + panel) wired to the two triggers Core modules can already produce — license expiry and backup outcome — that every later module calls into rather than building its own.

**Architecture:** `notification-rules.ts` is the pure, Electron-free layer — date math only (`isLicenseExpiringSoon`, `hasLicenseExpired`), unit-testable directly, matching `isBackupDue()` in `backup.ts`. `notification-store.ts` (electron-store, matching `backup-store.ts`) holds the low-level CRUD. `notifications.ts` is the Electron-aware orchestration layer every other file calls into — `notify()` persists via the store and pushes a live IPC event to the renderer, mirroring how `backup-manager.ts` sits above `backup-store.ts`. `notification-scheduler.ts` is a thin `setInterval` wrapper, matching `backup-scheduler.ts`.

**Tech Stack:** No new npm dependencies — reuses `electron-store` (already a dependency since `preferences.ts`/`backup-store.ts`) and Node's built-in `crypto` for notification IDs.

---

### Task 1: Shared notification types

**Files:**

- Modify: `shared/ipc.ts`

- [ ] **Step 1: Add notification channels, types, and AppApi members to shared/ipc.ts**

Add to `IPC_CHANNELS`:

```typescript
  listNotifications: 'notification:list',
  markNotificationRead: 'notification:mark-read',
  markAllNotificationsRead: 'notification:mark-all-read',
  clearNotification: 'notification:clear',
  notificationCreated: 'notification:created',
```

Add after the `BackupResult` interface:

```typescript
export type NotificationSeverity = 'info' | 'warning' | 'error';

export interface NotificationRecord {
  id: string;
  severity: NotificationSeverity;
  title: string;
  message: string;
  createdAt: string;
  read: boolean;
}
```

Add to `AppApi`:

```typescript
  listNotifications: () => Promise<NotificationRecord[]>;
  markNotificationRead: (id: string) => Promise<void>;
  markAllNotificationsRead: () => Promise<void>;
  clearNotification: (id: string) => Promise<void>;
  onNotificationCreated: (callback: (notification: NotificationRecord) => void) => () => void;
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm typecheck`
Expected: fails — `electron/preload/index.ts` doesn't implement the new `AppApi` members yet, fixed in Task 5. Confirm the failure is specifically about the missing members.

- [ ] **Step 3: Commit**

```bash
git checkout main
git pull
git checkout -b feature/notifications
git add shared/ipc.ts
git commit -m "Add notification types to the shared IPC contract"
```

---

### Task 2: Pure license-expiry rules, with tests

**Files:**

- Create: `tests/unit/notification-rules.test.ts`
- Create: `electron/main/services/core/notification-rules.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  hasLicenseExpired,
  isLicenseExpiringSoon,
} from '../../electron/main/services/core/notification-rules';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('hasLicenseExpired', () => {
  it('a license with no expiry never expires', () => {
    expect(hasLicenseExpired(null)).toBe(false);
  });

  it('a past date has expired', () => {
    expect(hasLicenseExpired(new Date(Date.now() - DAY_MS).toISOString())).toBe(true);
  });

  it('a future date has not expired', () => {
    expect(hasLicenseExpired(new Date(Date.now() + DAY_MS).toISOString())).toBe(false);
  });
});

describe('isLicenseExpiringSoon', () => {
  it('a license with no expiry is never expiring soon', () => {
    expect(isLicenseExpiringSoon(null, 14)).toBe(false);
  });

  it('an already-expired license is not "expiring soon"', () => {
    expect(isLicenseExpiringSoon(new Date(Date.now() - DAY_MS).toISOString(), 14)).toBe(false);
  });

  it('a date well within the threshold is expiring soon', () => {
    expect(isLicenseExpiringSoon(new Date(Date.now() + 10 * DAY_MS).toISOString(), 14)).toBe(true);
  });

  it('a date well beyond the threshold is not expiring soon', () => {
    expect(isLicenseExpiringSoon(new Date(Date.now() + 20 * DAY_MS).toISOString(), 14)).toBe(false);
  });

  it('is expiring soon just under the threshold', () => {
    const justUnder = new Date(Date.now() + 14 * DAY_MS - 1000).toISOString();
    expect(isLicenseExpiringSoon(justUnder, 14)).toBe(true);
  });

  it('is not expiring soon just over the threshold', () => {
    const justOver = new Date(Date.now() + 14 * DAY_MS + 60_000).toISOString();
    expect(isLicenseExpiringSoon(justOver, 14)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test`
Expected: FAIL — `Cannot find module '../../electron/main/services/core/notification-rules'`.

- [ ] **Step 3: Write electron/main/services/core/notification-rules.ts**

```typescript
export function hasLicenseExpired(expiresAt: string | null): boolean {
  if (!expiresAt) {
    return false;
  }
  return new Date(expiresAt).getTime() < Date.now();
}

export function isLicenseExpiringSoon(expiresAt: string | null, thresholdDays: number): boolean {
  if (!expiresAt) {
    return false;
  }
  const msRemaining = new Date(expiresAt).getTime() - Date.now();
  if (msRemaining <= 0) {
    return false;
  }
  return msRemaining <= thresholdDays * 24 * 60 * 60 * 1000;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test`
Expected: PASS — all new tests plus every pre-existing test.

- [ ] **Step 5: Commit**

```bash
git add tests/unit/notification-rules.test.ts electron/main/services/core/notification-rules.ts
git commit -m "Add pure license-expiry rules for notifications"
```

---

### Task 3: Notification history store

**Files:**

- Create: `electron/main/services/core/notification-store.ts`

- [ ] **Step 1: Write electron/main/services/core/notification-store.ts**

```typescript
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
```

Upserting by `id` filters out any existing record with the same id and puts the fresh one at the front — a repeated condition (e.g. the license still being close to expiry on the next scheduled check) refreshes to the top with a new timestamp and `read: false`, rather than accumulating duplicates.

- [ ] **Step 2: Verify typecheck**

Run: `pnpm typecheck`
Expected: same pre-existing `AppApi` failure as Task 1, nothing new.

- [ ] **Step 3: Commit**

```bash
git add electron/main/services/core/notification-store.ts
git commit -m "Add notification history store"
```

---

### Task 4: Notification orchestration layer

**Files:**

- Create: `electron/main/services/core/notifications.ts`

- [ ] **Step 1: Write electron/main/services/core/notifications.ts**

```typescript
import { randomUUID } from 'node:crypto';
import type { BrowserWindow } from 'electron';
import log from 'electron-log/main';
import { IPC_CHANNELS } from '@shared/ipc';
import {
  addOrUpdateNotification,
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
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm typecheck`
Expected: same pre-existing `AppApi` failure, nothing new.

- [ ] **Step 3: Commit**

```bash
git add electron/main/services/core/notifications.ts
git commit -m "Add notification orchestration layer"
```

---

### Task 5: Wire the notification IPC channels

**Files:**

- Modify: `electron/preload/index.ts`
- Modify: `electron/main/ipc/index.ts`

- [ ] **Step 1: Add the notification methods to electron/preload/index.ts**

Add `type NotificationRecord` to the existing `@shared/ipc` type import:

```typescript
import { IPC_CHANNELS, type AppApi, type NotificationRecord } from '@shared/ipc';
```

Add to the `api` object:

```typescript
  listNotifications: () => ipcRenderer.invoke(IPC_CHANNELS.listNotifications),
  markNotificationRead: (id) => ipcRenderer.invoke(IPC_CHANNELS.markNotificationRead, id),
  markAllNotificationsRead: () => ipcRenderer.invoke(IPC_CHANNELS.markAllNotificationsRead),
  clearNotification: (id) => ipcRenderer.invoke(IPC_CHANNELS.clearNotification, id),
  onNotificationCreated: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, notification: NotificationRecord) =>
      callback(notification);
    ipcRenderer.on(IPC_CHANNELS.notificationCreated, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.notificationCreated, listener);
  },
```

- [ ] **Step 2: Add the handlers to electron/main/ipc/index.ts**

Add the import:

```typescript
import {
  clearNotification,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '../services/core/notifications';
```

Add `NotificationRecord` to the existing `@shared/ipc` type import.

Add inside `registerIpcHandlers()`:

```typescript
ipcMain.handle(IPC_CHANNELS.listNotifications, (): NotificationRecord[] => listNotifications());

ipcMain.handle(IPC_CHANNELS.markNotificationRead, (_event, id: string): void =>
  markNotificationRead(id),
);

ipcMain.handle(IPC_CHANNELS.markAllNotificationsRead, (): void => markAllNotificationsRead());

ipcMain.handle(IPC_CHANNELS.clearNotification, (_event, id: string): void => clearNotification(id));
```

- [ ] **Step 3: Verify typecheck**

Run: `pnpm typecheck`
Expected: zero errors — this is what makes Task 1's expected failure go away.

- [ ] **Step 4: Verify lint and tests**

Run: `pnpm lint && pnpm test`
Expected: zero errors, all tests passing.

- [ ] **Step 5: Commit**

```bash
git add electron/preload/index.ts electron/main/ipc/index.ts
git commit -m "Wire notification IPC channels"
```

---

### Task 6: License-expiry scheduler

**Files:**

- Create: `electron/main/services/core/notification-scheduler.ts`
- Modify: `electron/main/index.ts`

- [ ] **Step 1: Write electron/main/services/core/notification-scheduler.ts**

```typescript
import { getActiveLicense } from './license-store';
import { hasLicenseExpired, isLicenseExpiringSoon } from './notification-rules';
import { notify } from './notifications';

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const EXPIRY_WARNING_THRESHOLD_DAYS = 14;
const LICENSE_EXPIRY_NOTIFICATION_ID = 'license-expiry';

function checkLicenseExpiry(): void {
  const { expiresAt } = getActiveLicense();

  if (hasLicenseExpired(expiresAt)) {
    notify({
      id: LICENSE_EXPIRY_NOTIFICATION_ID,
      severity: 'error',
      title: 'License expired',
      message: 'Your OMNES license has expired. Contact your administrator to renew it.',
    });
    return;
  }

  if (isLicenseExpiringSoon(expiresAt, EXPIRY_WARNING_THRESHOLD_DAYS)) {
    const daysRemaining = Math.ceil(
      (new Date(expiresAt as string).getTime() - Date.now()) / (24 * 60 * 60 * 1000),
    );
    notify({
      id: LICENSE_EXPIRY_NOTIFICATION_ID,
      severity: 'warning',
      title: 'License expiring soon',
      message: `Your OMNES license expires in ${daysRemaining} day${daysRemaining === 1 ? '' : 's'}.`,
    });
  }
}

export function startNotificationScheduler(): NodeJS.Timeout {
  checkLicenseExpiry();
  return setInterval(checkLicenseExpiry, CHECK_INTERVAL_MS);
}
```

An existing `license-expiry` notification is deliberately left alone if the license is renewed within the same running process — `license-store.ts` already caches the active license for the process lifetime, so this scheduler can't observe a renewal without a restart either; that's an existing, accepted constraint, not a new gap.

- [ ] **Step 2: Wire it into electron/main/index.ts**

Add the imports:

```typescript
import { startNotificationScheduler } from './services/core/notification-scheduler';
import { registerMainWindow } from './services/core/notifications';
```

Add the calls alongside the existing scheduler startup:

```typescript
const mainWindow = createMainWindow();
startIdleMonitor(mainWindow);
startBackupScheduler();
registerMainWindow(mainWindow);
startNotificationScheduler();
```

- [ ] **Step 3: Verify typecheck**

Run: `pnpm typecheck`
Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add electron/main/services/core/notification-scheduler.ts electron/main/index.ts
git commit -m "Add the license-expiry notification scheduler"
```

---

### Task 7: Backup outcome notifications

**Files:**

- Modify: `electron/main/services/core/backup-manager.ts`

- [ ] **Step 1: Add notify() calls to performManualBackup**

Add the import:

```typescript
import { notify } from './notifications';
```

Replace `performManualBackup`'s body:

```typescript
export function performManualBackup(): Promise<BackupResult> {
  return withExclusiveLock(async () => {
    try {
      const { filePath, sizeBytes } = await createBackup(getBackupsDir());
      const record = addBackupRecord(path.basename(filePath), sizeBytes);
      notify({
        severity: 'info',
        title: 'Backup created',
        message: `A new backup (${record.filename}) was created successfully.`,
      });
      return { success: true, message: 'Backup created', record };
    } catch (error) {
      log.error('Backup failed', error);
      notify({
        severity: 'error',
        title: 'Backup failed',
        message: toErrorMessage(error),
      });
      return { success: false, message: toErrorMessage(error), record: null };
    }
  });
}
```

Each call passes no `id`, so `notify()` generates a fresh UUID — every backup attempt (manual or, via `performScheduledBackupIfDue()` calling this same function, scheduled) gets its own notification entry rather than overwriting the last one, unlike the license-expiry check's stable id.

- [ ] **Step 2: Verify typecheck, lint, and tests**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: zero errors, all tests passing (including the real `pg_dump`/`pg_restore` round trip in `backup.test.ts`, unaffected by this change).

- [ ] **Step 3: Commit**

```bash
git add electron/main/services/core/backup-manager.ts
git commit -m "Notify on backup success and failure"
```

---

### Task 8: Notification locale strings

**Files:**

- Modify: `src/locales/en.json`, `src/locales/rw.json`, `src/locales/fr.json`

- [ ] _*Step 1: Add notifications.* keys to all three locale files_*

Add to `src/locales/en.json` (after the `backup.*` keys, before `modules.*`):

```json
  "notifications.bellLabel": "Notifications",
  "notifications.title": "Notifications",
  "notifications.markAllRead": "Mark all read",
  "notifications.close": "Close",
  "notifications.empty": "No notifications.",
  "notifications.clear": "Dismiss",
```

Add to `src/locales/rw.json`:

```json
  "notifications.bellLabel": "Amatangazo",
  "notifications.title": "Amatangazo",
  "notifications.markAllRead": "Emeza byose nk'ibisomwe",
  "notifications.close": "Funga",
  "notifications.empty": "Nta matangazo ahari.",
  "notifications.clear": "Kuraho",
```

Add to `src/locales/fr.json`:

```json
  "notifications.bellLabel": "Notifications",
  "notifications.title": "Notifications",
  "notifications.markAllRead": "Tout marquer comme lu",
  "notifications.close": "Fermer",
  "notifications.empty": "Aucune notification.",
  "notifications.clear": "Ignorer",
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm typecheck`
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/locales
git commit -m "Add notification locale strings"
```

---

### Task 9: NotificationBell and NotificationPanel UI

**Files:**

- Create: `src/modules/core/NotificationPanel.module.css`
- Create: `src/modules/core/NotificationPanel.tsx`
- Create: `src/modules/core/NotificationBell.module.css`
- Create: `src/modules/core/NotificationBell.tsx`

- [ ] **Step 1: Write src/modules/core/NotificationPanel.module.css**

```css
.panel {
  position: absolute;
  top: calc(100% + var(--space-2));
  right: 0;
  width: 320px;
  max-height: 400px;
  display: flex;
  flex-direction: column;
  background-color: var(--color-surface-raised);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  z-index: 10;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-3);
  border-bottom: 1px solid var(--color-border);
}

.title {
  font-weight: 600;
  font-size: 0.875rem;
}

.headerActions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.headerActions button {
  background: none;
  border: none;
  color: var(--color-text-secondary);
  font-size: 0.75rem;
  cursor: pointer;
}

.empty {
  padding: var(--space-4);
  margin: 0;
  color: var(--color-text-secondary);
  font-size: 0.875rem;
  text-align: center;
}

.list {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow-y: auto;
}

.item {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  border-bottom: 1px solid var(--color-border);
  border-left: 3px solid transparent;
}

.item[data-severity='warning'] {
  border-left-color: #e0a030;
}

.item[data-severity='error'] {
  border-left-color: #e5484d;
}

.item[data-severity='info'] {
  border-left-color: var(--color-focus-ring);
}

.item[data-read='true'] {
  opacity: 0.6;
}

.itemMain {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--space-3);
  background: none;
  border: none;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.itemTitle {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--color-text-primary);
}

.itemMessage {
  font-size: 0.75rem;
  color: var(--color-text-secondary);
}

.itemTime {
  font-size: 0.6875rem;
  color: var(--color-text-secondary);
}

.clearButton {
  padding: var(--space-3);
  background: none;
  border: none;
  color: var(--color-text-secondary);
  cursor: pointer;
}
```

- [ ] **Step 2: Write src/modules/core/NotificationPanel.tsx**

```typescript
import { useTranslation } from 'react-i18next';
import type { NotificationRecord } from '@shared/ipc';
import styles from './NotificationPanel.module.css';

interface NotificationPanelProps {
  notifications: NotificationRecord[];
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
  onClear: (id: string) => void;
}

export function NotificationPanel({
  notifications,
  onMarkRead,
  onMarkAllRead,
  onClear,
}: NotificationPanelProps) {
  const { t } = useTranslation();

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span className={styles.title}>{t('notifications.title')}</span>
        <div className={styles.headerActions}>
          <button type="button" onClick={onMarkAllRead}>
            {t('notifications.markAllRead')}
          </button>
        </div>
      </div>
      {notifications.length === 0 ? (
        <p className={styles.empty}>{t('notifications.empty')}</p>
      ) : (
        <ul className={styles.list}>
          {notifications.map((notification) => (
            <li
              key={notification.id}
              className={styles.item}
              data-severity={notification.severity}
              data-read={notification.read}
            >
              <button
                type="button"
                className={styles.itemMain}
                onClick={() => onMarkRead(notification.id)}
              >
                <span className={styles.itemTitle}>{notification.title}</span>
                <span className={styles.itemMessage}>{notification.message}</span>
                <span className={styles.itemTime}>
                  {new Date(notification.createdAt).toLocaleString()}
                </span>
              </button>
              <button
                type="button"
                className={styles.clearButton}
                onClick={() => onClear(notification.id)}
                aria-label={t('notifications.clear')}
              >
                &times;
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

The row's clickable title/message area and the dismiss button are sibling `<button>` elements, not nested — `<button>` inside `<button>` is invalid HTML and breaks keyboard/screen-reader navigation.

- [ ] **Step 3: Write src/modules/core/NotificationBell.module.css**

```css
.wrapper {
  position: relative;
}

.bellButton {
  position: relative;
  padding: var(--space-1) var(--space-2);
  background: none;
  border: none;
  font-size: 1rem;
  cursor: pointer;
}

.badge {
  position: absolute;
  top: 0;
  right: 0;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: #e5484d;
  border-radius: 8px;
  color: white;
  font-size: 0.625rem;
  font-weight: 600;
  line-height: 1;
}
```

- [ ] **Step 4: Write src/modules/core/NotificationBell.tsx**

```typescript
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { NotificationRecord } from '@shared/ipc';
import { NotificationPanel } from './NotificationPanel';
import styles from './NotificationBell.module.css';

export function NotificationBell() {
  const { t } = useTranslation();
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [isPanelOpen, setIsPanelOpen] = useState(false);

  const unreadCount = notifications.filter((notification) => !notification.read).length;

  useEffect(() => {
    let cancelled = false;
    window.omnes
      ?.listNotifications()
      .then((list) => {
        if (!cancelled) setNotifications(list);
      })
      .catch((error: unknown) => {
        console.error('Failed to list notifications', error);
      });

    const unsubscribe = window.omnes?.onNotificationCreated((notification) => {
      setNotifications((current) => [
        notification,
        ...current.filter((existing) => existing.id !== notification.id),
      ]);
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  const handleMarkRead = (id: string) => {
    void window.omnes?.markNotificationRead(id);
    setNotifications((current) =>
      current.map((notification) =>
        notification.id === id ? { ...notification, read: true } : notification,
      ),
    );
  };

  const handleMarkAllRead = () => {
    void window.omnes?.markAllNotificationsRead();
    setNotifications((current) =>
      current.map((notification) => ({ ...notification, read: true })),
    );
  };

  const handleClear = (id: string) => {
    void window.omnes?.clearNotification(id);
    setNotifications((current) => current.filter((notification) => notification.id !== id));
  };

  return (
    <div className={styles.wrapper}>
      <button
        type="button"
        className={styles.bellButton}
        onClick={() => setIsPanelOpen((open) => !open)}
        aria-label={t('notifications.bellLabel')}
      >
        <span aria-hidden="true">🔔</span>
        {unreadCount > 0 && <span className={styles.badge}>{unreadCount}</span>}
      </button>
      {isPanelOpen && (
        <NotificationPanel
          notifications={notifications}
          onMarkRead={handleMarkRead}
          onMarkAllRead={handleMarkAllRead}
          onClear={handleClear}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 5: Verify typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: zero errors — the `useEffect` here follows the same `.then()`/`cancelled`-flag shape already established in `AppShell.tsx` and `BackupPanel.tsx` specifically to satisfy the `react-hooks/set-state-in-effect` rule.

- [ ] **Step 6: Commit**

```bash
git add src/modules/core/NotificationBell.tsx src/modules/core/NotificationBell.module.css src/modules/core/NotificationPanel.tsx src/modules/core/NotificationPanel.module.css
git commit -m "Add notification bell and panel"
```

---

### Task 10: Wire the bell into AppShell

**Files:**

- Modify: `src/app/AppShell.tsx`

- [ ] **Step 1: Add the import**

```typescript
import { NotificationBell } from '../modules/core/NotificationBell';
```

- [ ] **Step 2: Render it in the titlebar, after the license badge and before userControls**

```tsx
        {licenseTier && (
          <span className={styles.licenseTier}>
            {t('shell.license')}: {licenseTier}
          </span>
        )}
        <NotificationBell />
        {session && (
```

- [ ] **Step 3: Verify typecheck, lint, and tests**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: zero errors, all tests passing.

- [ ] **Step 4: Commit**

```bash
git add src/app/AppShell.tsx
git commit -m "Add the notification bell to the titlebar"
```

---

### Task 11: Extend the e2e test

**Files:**

- Modify: `tests/e2e/app.spec.ts`

- [ ] **Step 1: Assert a real notification appears after the existing backup round trip**

Add right after the existing `expect(window.getByText(/^omnes-backup-/))` assertion (before the restore-flow block added by the Backup sub-project):

```typescript
await expect(window.getByLabel('Notifications')).toBeVisible();
await window.getByLabel('Notifications').click();
await expect(window.getByText('Backup created')).toBeVisible();
```

This proves the full path end-to-end: `performManualBackup()`'s success branch really calls `notify()`, the IPC push really reaches the renderer live (no reload happened), and the bell's badge/panel really reflect it.

- [ ] **Step 2: Rebuild and run the e2e tests**

Run: `pnpm build && pnpm exec playwright test`
Expected: both tests PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/app.spec.ts
git commit -m "Extend e2e test to verify a real notification appears"
```

---

### Task 12: Documentation, final verification, and merge

**Files:**

- Modify: `docs/architecture.md`

- [ ] **Step 1: Add a Notifications section to docs/architecture.md, before the IPC contract section**

Cover: the pure/orchestration split (`notification-rules.ts` vs `notifications.ts`/`notification-store.ts`), the upsert-by-id behavior and why (license-expiry uses a stable id, backup outcomes use fresh ones), the `registerMainWindow` pattern for pushing `notification:created` from any call site without threading a window reference through every layer, and that this sub-project only wires in the two triggers Core modules can currently produce — every later module's notifications call into this same system rather than building their own.

- [ ] **Step 2: Run the full local verification suite**

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm package
```

Expected: every command exits 0.

- [ ] **Step 3: Push the branch and open a PR**

```bash
git push -u origin feature/notifications
```

- [ ] **Step 4: Verify CI passes on GitHub, dispatch an independent code-review subagent, address findings**

Follow the same pattern as every prior sub-project: once CI is green, dispatch a fresh subagent to review the full branch diff against this plan and the design spec before merging.

- [ ] **Step 5: Merge via the finishing-a-development-branch skill once CI is green and review findings are addressed**
