# Project Foundation — Design

Status: Approved
Date: 2026-07-28

## Purpose

OMNES is a commercial desktop ERP suite, starting with POS and expanding into
inventory, CRM, reporting, and administration. This is the first sub-project:
it establishes the repository, tooling, and application shell that every
later module builds on. It contains no business logic. Its job is to prove
the stack boots, is secure by default, and is organized so each future
module (auth, licensing, database, POS, inventory, ...) can be added without
restructuring.

Success criteria: a developer can clone the repo, run one install command
and one dev command, and see a working Electron window with a splash screen,
a themed shell (sidebar with module placeholders, empty content area), and
CI that runs lint/typecheck/test/build on every pull request.

## Architecture

```
omnes/
├── .github/workflows/ci.yml
├── .husky/
├── assets/branding/
│   ├── logo-full.png
│   └── logo-transparent.png
├── docs/
│   ├── superpowers/specs/
│   └── architecture.md
├── electron/
│   ├── main/
│   │   ├── index.ts
│   │   ├── ipc/
│   │   └── services/
│   │       ├── core/
│   │       ├── pos/
│   │       ├── inventory/
│   │       ├── crm/
│   │       ├── reports/
│   │       └── admin/
│   └── preload/
│       └── index.ts
├── src/
│   ├── app/
│   ├── modules/
│   │   ├── core/
│   │   ├── pos/
│   │   ├── inventory/
│   │   ├── crm/
│   │   ├── reports/
│   │   └── admin/
│   ├── components/
│   ├── lib/
│   ├── locales/
│   │   ├── en.json
│   │   ├── rw.json
│   │   └── fr.json
│   └── styles/
├── shared/
├── tests/
│   ├── unit/
│   └── e2e/
├── electron-builder.yml
├── package.json
├── tsconfig.json / tsconfig.node.json / tsconfig.web.json
├── electron.vite.config.ts
├── eslint.config.js
├── .prettierrc
├── .env.example
├── .gitignore
├── .nvmrc
└── README.md
```

**electron/** is the main process. `services/` is the internal service-layer
boundary described in the master brief: one folder per business module, each
exposing plain functions that IPC handlers call into. It stays empty in this
sub-project (just `.gitkeep` placeholders) — no module has business logic
yet — but its existence now means later modules have one obvious place to
put their service functions instead of scattering logic across IPC handlers.

**shared/** holds TypeScript types for the IPC contract between main and
renderer (request/response shapes), so both sides import from one source of
truth instead of duplicating types.

**src/modules/** mirrors the same six-module split on the renderer side.
Each module folder is empty for now except for whatever the shell needs to
list it in the sidebar.

## Components

- **electron-vite** coordinates three builds (main, preload, renderer) with
  one dev command and HMR on the renderer.
- **Main process** (`electron/main/index.ts`): creates the BrowserWindow with
  `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, and a
  restrictive CSP applied via a `session.webRequest` header. No remote
  content is loaded.
- **Preload** (`electron/preload/index.ts`): exposes a minimal typed bridge
  via `contextBridge` — for this sub-project, just `getAppVersion()` — to
  establish the pattern future IPC calls will follow. No direct Node or
  Electron API is exposed to the renderer.
- **Renderer shell** (`src/app/`): React Router with a single layout route —
  title bar, sidebar (six module entries, disabled/"coming soon" except
  none are functional yet), and a content area with an empty state. A
  splash screen (using the transparent logo) shows while the shell mounts.
- **Theming** (`src/styles/`): dark-mode-first base tokens — background,
  surface, text (primary/secondary), border, focus ring. This is
  deliberately minimal: the full brand palette (primary/accent/success/
  warning/danger/etc. derived from the logo) is out of scope here and
  belongs to the later `feature/themes` sub-project.
- **i18n** (`src/lib/i18n.ts`, `src/locales/*.json`): the translation layer
  is wired for real using i18next + react-i18next. English is the complete
  source of truth. Kinyarwanda and French files translate the actual
  strings the shell uses (app name, "Loading...", sidebar labels, "Coming
  soon" empty state) — a small, verifiable set, not placeholder content.
- **State/data libraries**: Zustand and TanStack Query are installed and
  configured (query client provider wired in `src/app/`) but have no real
  usage yet beyond the provider — there is no data to fetch until
  `feature/database` exists.

## Data flow

None yet — no database, no business data. The only "data" in this
sub-project is the app version read in the main process and passed to the
renderer over the typed preload bridge, purely to prove the IPC pattern
works end to end.

## Error handling

- Renderer: a top-level React error boundary around the shell layout,
  rendering a plain "something went wrong" state rather than a blank
  window, with the error logged via the logging setup below.
- Main process: unhandled exceptions and unhandled promise rejections are
  caught at the process level and written to a log file (see Logging)
  instead of crashing silently.
- No feature-specific error handling exists yet since there are no features;
  this sub-project only establishes the catch-all safety net.

## Logging

A minimal file logger in the main process (rotating daily log file under the
app's userData directory) captures startup, shutdown, and any uncaught
errors. This is intentionally small — full structured logging per module
grows as those modules are added.

## Testing

- **Unit (vitest)**: one real test — a shared utility function (e.g. a
  className-merging helper actually used by `components/`) — and one
  render test for the shell layout confirming the sidebar lists all six
  modules.
- **E2E (Playwright, Electron support)**: one real smoke test that launches
  the built Electron app, waits for the main window, and asserts the window
  title and that the sidebar renders.
- **CI**: `.github/workflows/ci.yml` runs on every pull request against
  `main`: install (pnpm, cached), lint, typecheck, unit test, and a
  production build (`electron-vite build`). No packaging/installer step yet
  — that belongs to `feature/build`/`feature/installer` later.

## Packaging (sanity only)

`electron-builder.yml` is configured for a Windows directory build only
(`target: dir`, no NSIS installer, no code signing) using the full logo as
a placeholder app icon. Its only purpose here is to confirm the app packages
without errors. Installer UI, licensing pages, and code signing are explicit
`Deferred Scope` items handled in the `feature/installer` sub-project.

## Out of scope for this sub-project

Database/Prisma, authentication, licensing validation, backup, the full
brand color palette, full i18n content coverage, mobile money, any POS/
inventory/CRM/reports business logic, installer polish, code signing. Each
gets its own spec when its turn comes, per the module order in the master
brief (Core infrastructure → POS → Inventory → CRM → Reports →
Administration).

## Git workflow

- Branch: `feature/scaffold`, off `main`.
- Multiple small commits as the shell is built up (tooling init →
  electron-vite wiring → renderer shell/routing → i18n → theme tokens →
  logging → testing setup → CI workflow → packaging sanity config).
- Remote: `origin` set to `github.com/tuyisengeaurele/omnes`; branch pushed
  as work progresses.
- Merge to `main` via a normal merge commit once the shell builds, lints,
  type-checks, and passes its tests locally and in CI.
