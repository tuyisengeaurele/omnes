# Notifications — Design

Status: Approved
Date: 2026-08-01

## Purpose

OMNES needs a way to surface important but non-blocking information — a
license about to expire, a scheduled backup that failed overnight — without
interrupting whatever the user is doing, and without it being lost the
moment it scrolls off screen. This sub-project adds a general in-app
notification system (a titlebar bell with an unread count, and a panel
listing history) and wires in the two concrete triggers Core modules can
already produce: license expiry and backup outcome. It is the last of the
"Core" sub-projects (Authentication, Licensing, Database, Backup,
Notifications) before POS/Inventory/CRM/Reports/Administration begin — every
later module that needs to notify the user (low stock, sync failures, etc.)
calls into this system rather than building its own.

Success criteria: a notification created anywhere in the main process is
immediately visible in the renderer (bell badge increments, panel shows it)
without a page reload; notifications persist across app restarts; the
license-expiry check runs on startup and periodically, using a stable ID so
repeated checks update one entry instead of spamming duplicates; a real
backup failure produces a real notification, not just a log line.

## Architecture

```
electron/main/services/core/
├── notification-rules.ts   # pure: isLicenseExpiringSoon() date math
├── notification-store.ts    # electron-store: notification history
├── notifications.ts          # orchestration: notify(), push to renderer
└── notification-scheduler.ts # periodic license-expiry check, matches
                                #   backup-scheduler.ts
electron/main/
├── index.ts                   # registers the main window with
                                #   notifications.ts, starts the scheduler
├── ipc/index.ts                # + notification:list/markRead/
                                 #   markAllRead/clear handlers
└── services/core/backup-manager.ts  # calls notify() on backup outcome
shared/
└── ipc.ts                     # + Notification type, channels, AppApi
src/modules/core/
├── NotificationBell.tsx        # titlebar icon + unread badge + panel
└── NotificationPanel.tsx        # dropdown list, mark read/clear
src/app/
└── AppShell.tsx                 # titlebar gets the bell
```

## Components

- **`notification-rules.ts`**: pure date-math logic, no Electron or store
  dependency — `isLicenseExpiringSoon(expiresAt: string | null, thresholdDays:
number): boolean` (false for `null`, i.e. the `DEVELOPMENT` license never
  expires) and `hasLicenseExpired(expiresAt: string | null): boolean`. This
  is what makes the trigger logic unit-testable directly, the same role
  `isBackupDue()` plays in `backup.ts`.
- **`notification-store.ts`**: `electron-store`-backed history (`name:
'notifications'`, its own file, same pattern as `backup-store.ts`), an
  array of `{ id, severity, title, message, createdAt, read }` records.
  `addOrUpdateNotification(id, ...)` upserts by `id` — most callers pass a
  stable, deterministic ID (e.g. `'license-expiry'`) so a condition that's
  still true on the next check refreshes the existing entry (new
  `createdAt`, `read: false` again) instead of creating a duplicate; a
  caller that wants a genuinely new entry each time (e.g. one specific
  backup failure) passes a fresh UUID instead.
- **`notifications.ts`**: `notify({ id?, severity, title, message })` —
  writes to `notification-store.ts`, then pushes a `notification:created`
  IPC event to the renderer if a window is registered. Exposes
  `registerMainWindow(window: BrowserWindow)`, called once from
  `electron/main/index.ts` right after `createMainWindow()`, mirroring how
  `startIdleMonitor(window)` already needs the window reference — except
  here the reference is stored module-level so every future call site
  (`backup-manager.ts`, the license scheduler, and any future module) can
  call `notify()` without threading a window reference through every layer
  that might need to raise one.
- **`notification-scheduler.ts`**: same `setInterval` shape as
  `backup-scheduler.ts` — checks license expiry immediately on startup and
  every 6 hours while running. Reads `getActiveLicense()` (already
  established in `license-store.ts`), and calls `notify()` with the stable
  id `'license-expiry'`: `severity: 'error'` and an "expired" message if
  `hasLicenseExpired`, `severity: 'warning'` and a "expires in N days"
  message if `isLicenseExpiringSoon` (14-day threshold), or does nothing if
  neither — an existing `license-expiry` notification is left alone (not
  cleared) if the license later gets renewed within the same process
  lifetime, since `license-store.ts` already caches the license for the
  process lifetime and won't observe a renewal without a restart anyway.
- **Backup integration**: `backup-manager.ts`'s `performManualBackup()`
  calls `notify()` on both its success and failure return paths (a fresh
  UUID id, not a stable one — each backup attempt is its own event). Since
  `performScheduledBackupIfDue()` already calls `performManualBackup()`
  internally, this covers both manual and scheduled backups through one
  call site, with no separate wiring needed for the scheduled path. This is
  additive to `BackupPanel`'s existing inline status message, not a
  replacement — the panel's message is transient, immediate feedback; the
  bell is a persistent record of outcomes the user can check later even if
  they weren't looking at Administration when a scheduled backup ran.
- **IPC**: `notification:list` (all notifications, newest first),
  `notification:markRead` (id), `notification:markAllRead`,
  `notification:clear` (id, removes it from history — distinct from
  "read", the way email has both), `notification:created` (main-initiated
  push event, the renderer subscribes the same way `onSessionLocked`
  already does).
- **UI**: `NotificationBell.tsx` sits in `AppShell`'s titlebar, after the
  license badge and before `userControls` — a bell icon with a small
  unread-count badge (hidden at 0), toggling `NotificationPanel.tsx` open on
  click. The panel lists notifications newest-first, color-coded by
  severity, each with its message and a relative timestamp; clicking one
  marks it read; a "Clear all" action empties the list. The bell subscribes
  to `notification:created` on mount so a live push updates the badge count
  without polling.

## Data flow

License expiry: `notification-scheduler.ts`'s timer → `getActiveLicense()`
→ `notification-rules.ts` predicates → `notify()` (stable id) →
`notification-store.ts` persists → IPC push to the renderer if a window
exists. Backup outcome: `performManualBackup()`'s existing try/catch →
`notify()` (fresh id) → same persist-and-push path. Renderer: `bell` badge
count comes from `notification:list`'s unread count on mount, kept live via
the `notification:created` subscription; opening the panel calls
`notification:list` again for the full history; marking read/clearing calls
the corresponding IPC method and locally updates renderer state (no need to
re-fetch the whole list for a single-item change).

## Error handling

- If `notification:created` fires while no window exists yet (a narrow
  startup race), the notification is still persisted by `notify()` — it
  just won't show as a live push; the renderer picks it up on its next
  `notification:list` call regardless (on mount).
- A failure inside `notify()` itself (e.g. `electron-store` write failure)
  is logged via electron-log and swallowed, not thrown — a broken
  notification write must never crash the operation that triggered it
  (a failed backup notification must not, itself, throw and mask the
  original backup failure it was reporting).

## Testing

- `notification-rules.ts` is pure and unit-tested directly, matching
  `isBackupDue()`'s tests: `isLicenseExpiringSoon`/`hasLicenseExpired`
  against `null`, a far-future date, a near-future date on both sides of
  the 14-day threshold, and a past date.
- `notification-store.ts` and `notifications.ts` are Electron-dependent
  (electron-store, `BrowserWindow`) and aren't unit-tested directly, same
  as `backup-store.ts`/`backup-manager.ts`.
- e2e: after reaching the shell, the bell is visible with its badge at 0
  (a fresh install has no license-expiry issue — the bootstrapped e2e
  license is `DEVELOPMENT`, `expiresAt: null` — and no backup has run yet
  in that test), then a manual "Back up now" (already exercised by the
  Backup sub-project's e2e test) is confirmed to produce a real
  notification: the badge increments and the panel shows a "Backup
  created" entry.

## Out of scope for this sub-project

Database-connectivity notifications (nothing currently polls DB health
continuously — `AppShell` only checks once on mount — so there is no
"transition to offline" event to notify on yet; revisit once something
actually polls), OS-level native toast notifications (this is an in-app
bell/panel only, not `Notification` API / OS notification center
integration — the master brief doesn't call for it and it adds a real
permissions/platform surface for no clear benefit yet), session-lock
notifications (redundant with the dedicated `LockScreen` UI already shown
the moment it happens), notification preferences/muting (no user has asked
for control over which notifications appear — everything the two triggers
produce is important enough to always show), and any module-specific
trigger like low-stock alerts (Inventory doesn't exist yet — this
sub-project only builds the seam, not every future producer).

## Git workflow

- Branch: `feature/notifications`, off `main`.
- Multiple small commits: shared types → `notification-rules.ts` + tests →
  `notification-store.ts` → `notifications.ts` → IPC wiring → scheduler →
  backup integration → `NotificationBell`/`NotificationPanel` UI → e2e.
- Merge to `main` via PR once verified locally and in CI.
