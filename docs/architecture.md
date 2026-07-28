# Architecture

## Process layout

OMNES is an Electron app built with `electron-vite`, which coordinates three separate
builds from one config (`electron.vite.config.ts`):

- `electron/main` — the main process: window lifecycle, security policy, logging, and
  IPC handler registration. Built as ESM (`out/main/index.js`).
- `electron/preload` — a preload script that exposes a narrow, typed API
  (`window.omnes`) to the renderer via `contextBridge`. Built as CommonJS
  (`out/preload/index.cjs`), deliberately overriding electron-vite's ESM default —
  see "Preload build format" below.
- `src` — the renderer, a React application, built to `out/renderer`.

## Security baseline

Every `BrowserWindow` is created with `contextIsolation: true`, `nodeIntegration:
false`, and `sandbox: true`. A restrictive Content-Security-Policy is applied to all
responses via `session.defaultSession.webRequest.onHeadersReceived`, and mirrored in
the renderer's `index.html` as a meta tag for the initial load. External links are
routed through `shell.openExternal` rather than opened as new `BrowserWindow`s.

### Preload build format

`package.json` sets `"type": "module"`, and electron-vite's default behavior is to
build both the main and preload processes as ESM when that's set. The main process
build works fine as ESM. The preload build does not: Electron's sandboxed preload
loader (required by `sandbox: true` above) runs preload scripts through a restricted
bundle that cannot execute `import`/ESM syntax at all. An ESM preload script fails
silently — `window.omnes` is simply `undefined` in the renderer, with the real error
(`SyntaxError: Cannot use import statement outside a module`) visible only in the main
process's console output, not in any renderer-facing error. `electron.vite.config.ts`
therefore forces the preload build's output to `format: 'cjs'` with an explicit `.cjs`
extension, and `electron/main/index.ts` references `../preload/index.cjs` accordingly.
Don't "simplify" this back to matching the main process's ESM output — it will break
the preload silently, not loudly.

## Service-layer boundary

`electron/main/services/` has one folder per business module (`core`, `pos`,
`inventory`, `crm`, `reports`, `admin`). IPC handlers in `electron/main/ipc/` call into
these service modules rather than containing business logic themselves. This keeps
main-process logic testable independent of Electron, and is the seam a future
REST/GraphQL API or cloud sync layer would be built behind, without rewriting business
logic. These folders are empty until the modules that need them are built.

## IPC contract

Types shared between main and renderer live in `shared/`, so both sides import from one
source of truth instead of duplicating request/response shapes. `shared/ipc.ts` defines
the channel names and the `AppApi` shape the preload script implements and the renderer
consumes via `window.omnes`.

## Renderer structure

`src/app/` holds routing and shell layout (`App.tsx`, `AppShell.tsx`,
`SplashScreen.tsx`). `src/modules/` mirrors the six business modules on the renderer
side, matching the main-process service layout — each module's UI lives in its own
folder as it's built. `src/components/` holds UI that's shared across modules.
`src/lib/` holds cross-cutting infrastructure: i18n setup, the Zustand UI store, and
small utilities.

The app boots by gating on `i18nReady` (i18next's real `init()` promise, not a fake
timer) before rendering the shell; while waiting, it renders `SplashScreen` as a plain
early return. `HashRouter` is used instead of browser history routing because the
production build loads `index.html` via `file://`, where a history-API router would
break on refresh or deep links.

## Theming

`src/styles/tokens.css` defines a minimal dark-first token set (background, surface,
text, border, focus ring, spacing, radii) consumed via CSS Modules. This is
intentionally small — the full brand color palette (primary/accent/success/warning/
danger and chart colors, derived from the OMNES logo) is designed in a later
sub-project, not guessed at here.

## Internationalization

`src/lib/i18n.ts` wires `i18next` with English as the source of truth and Kinyarwanda/
French translations alongside it, loaded as static JSON under `src/locales/`. Every
user-facing string in the app goes through this layer from the start; modules should
never hardcode English text.

## Branding assets

`assets/branding/logo-full.png` and `assets/branding/logo-transparent.png` are the
canonical, versioned logo assets. The renderer reaches them via the `@branding` alias
configured in both `electron.vite.config.ts` and `vitest.config.ts`.

## Testing

Unit tests (Vitest + Testing Library) cover pieces with real logic: the `cn` class-name
utility and `AppShell`'s sidebar rendering. An end-to-end test (Playwright, using its
Electron support) launches the actual built app and verifies the window title, sidebar
content, and that the `window.omnes.getAppVersion()` IPC round trip genuinely works —
this is what originally caught the preload build-format bug described above.
