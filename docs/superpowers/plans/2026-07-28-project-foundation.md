# Project Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the OMNES Electron + React + TypeScript shell — tooling, secure app bootstrap, themed empty-state UI, i18n, and CI — so every later module (auth, database, POS, ...) has a working, tested foundation to build on.

**Architecture:** electron-vite coordinates three builds (main, preload, renderer). The main process owns window/security/logging and an empty per-module `services/` boundary. The renderer is a React Router shell (splash → sidebar layout with six disabled module placeholders) styled with CSS Modules over a small dark-theme token set, translated via i18next. No database, auth, or business logic exists yet — see the approved spec for what's explicitly deferred.

**Tech Stack:** Electron, electron-vite, React 18, TypeScript, React Router, TanStack Query, Zustand, i18next/react-i18next, Framer Motion, electron-log, ESLint (flat config) + Prettier + Husky/lint-staged, Vitest + Testing Library, Playwright (Electron), electron-builder, GitHub Actions.

**Note on TDD in this plan:** Per the approved spec's Testing section, unit/e2e tests cover the pieces that have real logic to test — the `cn` utility, the `AppShell` sidebar rendering, and an end-to-end app launch. Config and wiring files (tsconfig, electron-vite config, CSS, IPC plumbing) don't have a meaningful "red" state to write a failing test against; those tasks are verified instead by running the relevant command (`typecheck`, `lint`, `dev`, `build`) and checking real output.

**Deliberately not installed yet (YAGNI):** React Hook Form, Zod, React PDF, React To Print, Chart.js, Electron Store, `node-thermal-printer`, `bwip-js`/`jsbarcode`, `axios`. These are real parts of the master tech stack but have no consumer yet — they get added in the sub-project that first needs them (onboarding wizard, PDF reports, receipt printing, settings persistence) rather than sitting unused in Foundation.

---

### Task 1: Package manifest and scripts

**Files:**
- Create: `package.json`
- Create: `.nvmrc`

- [ ] **Step 1: Write package.json**

```json
{
  "name": "omnes",
  "version": "0.1.0",
  "private": true,
  "license": "UNLICENSED",
  "description": "OMNES desktop business suite",
  "author": "Ange Aurele Tuyisenge",
  "type": "module",
  "engines": {
    "node": ">=22.0.0"
  },
  "main": "./out/main/index.mjs",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "preview": "electron-vite preview",
    "typecheck": "tsc --noEmit -p tsconfig.node.json && tsc --noEmit -p tsconfig.web.json",
    "lint": "eslint .",
    "lint:fix": "eslint . --fix",
    "format": "prettier --write .",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "electron-vite build && playwright test",
    "package": "electron-vite build && electron-builder --dir",
    "prepare": "husky"
  },
  "lint-staged": {
    "*.{ts,tsx}": [
      "eslint --fix",
      "prettier --write"
    ],
    "*.{css,json,md,yml,yaml}": [
      "prettier --write"
    ]
  }
}
```

Note: `main` points at `index.mjs`, not `index.js`. Because `"type": "module"` is set, electron-vite builds the main process as ESM and names its entry `[name].mjs` — this must match what Task 7 actually produces.

- [ ] **Step 2: Write .nvmrc**

```
22
```

- [ ] **Step 3: Commit**

```bash
git checkout -b feature/scaffold
git add package.json .nvmrc
git commit -m "Initialize package manifest and scripts"
```

---

### Task 2: Install dependencies

**Files:**
- Modify: `package.json`
- Create: `pnpm-lock.yaml`

- [ ] **Step 1: Install runtime dependencies**

Run:
```bash
pnpm add react react-dom react-router-dom @tanstack/react-query zustand i18next react-i18next electron-log framer-motion
```

- [ ] **Step 2: Install dev dependencies**

Run:
```bash
pnpm add -D electron electron-vite vite @vitejs/plugin-react electron-builder typescript typescript-eslint @eslint/js eslint eslint-plugin-react eslint-plugin-react-hooks eslint-plugin-react-refresh eslint-config-prettier prettier husky lint-staged vitest jsdom @testing-library/react @testing-library/jest-dom @playwright/test @types/react @types/react-dom @types/node
```

- [ ] **Step 3: Verify install succeeded**

Run: `pnpm list --depth 0`
Expected: no errors, all packages listed with resolved versions.

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "Install core dependencies"
```

---

### Task 3: Move branding assets into the repo

**Files:**
- Create: `assets/branding/logo-full.png`
- Create: `assets/branding/logo-transparent.png`
- Delete: `omnes_logo.png`, `omes_logo_no_bg.png` (root copies)

- [ ] **Step 1: Move the files**

Run:
```bash
mkdir -p assets/branding
mv omnes_logo.png assets/branding/logo-full.png
mv omes_logo_no_bg.png assets/branding/logo-transparent.png
```

- [ ] **Step 2: Verify**

Run: `ls assets/branding`
Expected: `logo-full.png` and `logo-transparent.png` listed.

- [ ] **Step 3: Commit**

```bash
git add assets/branding omnes_logo.png omes_logo_no_bg.png
git commit -m "Move branding assets into versioned assets directory"
```

---

### Task 4: Shared IPC types and TypeScript project configuration

**Files:**
- Create: `shared/ipc.ts`
- Create: `tsconfig.json`
- Create: `tsconfig.node.json`
- Create: `tsconfig.web.json`
- Create: `src/env.d.ts`

- [ ] **Step 1: Write shared/ipc.ts**

```typescript
export const IPC_CHANNELS = {
  getAppVersion: 'app:get-version',
} as const;

export interface AppApi {
  getAppVersion: () => Promise<string>;
}
```

- [ ] **Step 2: Write tsconfig.json**

```json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.node.json" },
    { "path": "./tsconfig.web.json" }
  ]
}
```

- [ ] **Step 3: Write tsconfig.node.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "types": ["node"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "baseUrl": ".",
    "paths": {
      "@shared/*": ["shared/*"]
    }
  },
  "include": [
    "electron/main/**/*.ts",
    "electron/preload/**/*.ts",
    "shared/**/*.ts"
  ]
}
```

- [ ] **Step 4: Write tsconfig.web.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "module": "ESNext",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "moduleResolution": "Bundler",
    "strict": true,
    "jsx": "react-jsx",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"],
      "@shared/*": ["shared/*"],
      "@branding/*": ["assets/branding/*"]
    }
  },
  "include": ["src/**/*.ts", "src/**/*.tsx", "shared/**/*.ts"]
}
```

- [ ] **Step 5: Write src/env.d.ts**

```typescript
/// <reference types="vite/client" />

import type { AppApi } from '../shared/ipc';

declare global {
  interface Window {
    omnes: AppApi;
  }
}

declare module '*.module.css' {
  const classes: { readonly [key: string]: string };
  export default classes;
}

declare module '*.png' {
  const src: string;
  export default src;
}

export {};
```

- [ ] **Step 6: Verify typecheck runs cleanly**

Run: `pnpm typecheck`
Expected: both `tsconfig.node.json` and `tsconfig.web.json` compile with zero errors (each has at least one real input file already).

- [ ] **Step 7: Commit**

```bash
git add shared tsconfig.json tsconfig.node.json tsconfig.web.json src/env.d.ts
git commit -m "Add shared IPC types and TypeScript project configuration"
```

---

### Task 5: electron-vite build configuration

**Files:**
- Create: `electron.vite.config.ts`
- Modify: `tsconfig.node.json` (add `electron.vite.config.ts` to `include`)

- [ ] **Step 1: Write electron.vite.config.ts**

```typescript
import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';

const root = import.meta.dirname;

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: resolve(root, 'electron/main/index.ts'),
      },
    },
  },
  preload: {
    build: {
      rollupOptions: {
        input: resolve(root, 'electron/preload/index.ts'),
      },
    },
  },
  renderer: {
    root: 'src',
    resolve: {
      alias: {
        '@': resolve(root, 'src'),
        '@shared': resolve(root, 'shared'),
        '@branding': resolve(root, 'assets/branding'),
      },
    },
    plugins: [react()],
    build: {
      rollupOptions: {
        input: resolve(root, 'src/index.html'),
      },
    },
  },
});
```

Note: use `import.meta.dirname` (stable in Node 22, works correctly regardless of how the ESM config file is loaded) rather than `__dirname`, since `package.json` has `"type": "module"` and this config file is loaded directly by the `electron-vite` CLI's config loader, not run through electron-vite's own main/preload CJS build step.

- [ ] **Step 2: Add electron.vite.config.ts to tsconfig.node.json's include array**

In `tsconfig.node.json`, change `include` to:

```json
  "include": [
    "electron/main/**/*.ts",
    "electron/preload/**/*.ts",
    "shared/**/*.ts",
    "electron.vite.config.ts"
  ]
```

- [ ] **Step 3: Verify typecheck still passes**

Run: `pnpm typecheck`
Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add electron.vite.config.ts tsconfig.node.json
git commit -m "Configure electron-vite build targets"
```

---

### Task 6: Vitest configuration and Testing Library setup

**Files:**
- Create: `vitest.config.ts`
- Create: `tests/unit/setup.ts`

- [ ] **Step 1: Write vitest.config.ts**

```typescript
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const root = import.meta.dirname;

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(root, 'src'),
      '@shared': resolve(root, 'shared'),
      '@branding': resolve(root, 'assets/branding'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./tests/unit/setup.ts'],
    include: ['tests/unit/**/*.test.{ts,tsx}'],
  },
});
```

Note: use `import.meta.dirname` here too, for the same reason as `electron.vite.config.ts` (see Task 5).

- [ ] **Step 2: Write tests/unit/setup.ts**

```typescript
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 3: Verify vitest runs with zero tests**

Run: `pnpm test`
Expected: Vitest starts, reports "No test files found" (no `.test.ts` files exist yet) — this confirms the runner and jsdom environment load without configuration errors, before any real tests are added.

- [ ] **Step 4: Commit**

```bash
git add vitest.config.ts tests/unit/setup.ts
git commit -m "Configure Vitest with jsdom and Testing Library"
```

---

### Task 7: Main process bootstrap

**Files:**
- Create: `electron/main/ipc/index.ts`
- Create: `electron/main/index.ts`

- [ ] **Step 1: Write electron/main/ipc/index.ts**

```typescript
import { app, ipcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc';

export function registerIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.getAppVersion, () => app.getVersion());
}
```

- [ ] **Step 2: Write electron/main/index.ts**

```typescript
import { app, BrowserWindow, session, shell } from 'electron';
import { join } from 'node:path';
import log from 'electron-log/main';
import { registerIpcHandlers } from './ipc';

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
      preload: join(dirname, '../preload/index.mjs'),
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
  createMainWindow();

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

process.on('uncaughtException', (error) => {
  log.error('Uncaught exception', error);
});

process.on('unhandledRejection', (reason) => {
  log.error('Unhandled rejection', reason);
});
```

- [ ] **Step 3: Verify typecheck still passes**

Run: `pnpm typecheck`
Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add electron/main
git commit -m "Add secure main process bootstrap with logging and CSP"
```

---

### Task 8: Preload script

**Files:**
- Create: `electron/preload/index.ts`

- [ ] **Step 1: Write electron/preload/index.ts**

```typescript
import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS, type AppApi } from '@shared/ipc';

const api: AppApi = {
  getAppVersion: () => ipcRenderer.invoke(IPC_CHANNELS.getAppVersion),
};

contextBridge.exposeInMainWorld('omnes', api);
```

- [ ] **Step 2: Verify typecheck still passes**

Run: `pnpm typecheck`
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add electron/preload
git commit -m "Add preload bridge exposing typed app API"
```

---

### Task 9: i18n setup and locale files

**Files:**
- Create: `src/locales/en.json`
- Create: `src/locales/rw.json`
- Create: `src/locales/fr.json`
- Create: `src/lib/i18n.ts`

- [ ] **Step 1: Write src/locales/en.json**

```json
{
  "app.name": "OMNES",
  "shell.loading": "Loading...",
  "shell.comingSoon": "Coming soon",
  "modules.core": "Core",
  "modules.pos": "Point of Sale",
  "modules.inventory": "Inventory",
  "modules.crm": "Customers",
  "modules.reports": "Reports",
  "modules.admin": "Administration"
}
```

- [ ] **Step 2: Write src/locales/rw.json**

```json
{
  "app.name": "OMNES",
  "shell.loading": "Turacyategura...",
  "shell.comingSoon": "Bizaza vuba",
  "modules.core": "Ibanze",
  "modules.pos": "Kugurisha",
  "modules.inventory": "Ububiko",
  "modules.crm": "Abakiriya",
  "modules.reports": "Raporo",
  "modules.admin": "Ubuyobozi"
}
```

- [ ] **Step 3: Write src/locales/fr.json**

```json
{
  "app.name": "OMNES",
  "shell.loading": "Chargement...",
  "shell.comingSoon": "Bientôt disponible",
  "modules.core": "Cœur",
  "modules.pos": "Point de vente",
  "modules.inventory": "Inventaire",
  "modules.crm": "Clients",
  "modules.reports": "Rapports",
  "modules.admin": "Administration"
}
```

- [ ] **Step 4: Write src/lib/i18n.ts**

```typescript
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '../locales/en.json';
import rw from '../locales/rw.json';
import fr from '../locales/fr.json';

export const i18nReady = i18next.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    rw: { translation: rw },
    fr: { translation: fr },
  },
  lng: 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

export default i18next;
```

- [ ] **Step 5: Commit**

```bash
git add src/locales src/lib/i18n.ts
git commit -m "Wire i18next with English, Kinyarwanda, and French shell strings"
```

---

### Task 10: Theme tokens and global styles

**Files:**
- Create: `src/styles/tokens.css`
- Create: `src/styles/global.css`

- [ ] **Step 1: Write src/styles/tokens.css**

```css
:root {
  color-scheme: dark;

  --color-background: #0b0d12;
  --color-surface: #12151c;
  --color-surface-raised: #181c25;
  --color-border: #262b36;
  --color-text-primary: #e8eaed;
  --color-text-secondary: #9aa1ac;
  --color-focus-ring: #4f7cff;

  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 16px;

  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-6: 24px;

  --font-family-base: 'Inter', system-ui, -apple-system, sans-serif;
}
```

- [ ] **Step 2: Write src/styles/global.css**

```css
@import './tokens.css';

*,
*::before,
*::after {
  box-sizing: border-box;
}

html,
body,
#root {
  height: 100%;
  margin: 0;
}

body {
  background-color: var(--color-background);
  color: var(--color-text-primary);
  font-family: var(--font-family-base);
  -webkit-font-smoothing: antialiased;
}

button {
  font-family: inherit;
}

:focus-visible {
  outline: 2px solid var(--color-focus-ring);
  outline-offset: 2px;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/styles
git commit -m "Add dark-theme base tokens and global styles"
```

---

### Task 11: Shared class-name utility, with a real unit test

**Files:**
- Create: `tests/unit/cn.test.ts`
- Create: `src/lib/cn.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from 'vitest';
import { cn } from '../../src/lib/cn';

describe('cn', () => {
  it('joins truthy class names with a space', () => {
    expect(cn('a', 'b', 'c')).toBe('a b c');
  });

  it('drops falsy values', () => {
    expect(cn('a', false, null, undefined, 'b')).toBe('a b');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test`
Expected: FAIL — `Cannot find module '../../src/lib/cn'`.

- [ ] **Step 3: Write src/lib/cn.ts**

```typescript
type ClassValue = string | number | false | null | undefined;

export function cn(...values: ClassValue[]): string {
  return values.filter(Boolean).join(' ');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test`
Expected: PASS — 2 tests passed.

- [ ] **Step 5: Commit**

```bash
git add tests/unit/cn.test.ts src/lib/cn.ts
git commit -m "Add cn class-name utility"
```

---

### Task 12: Zustand UI store

**Files:**
- Create: `src/lib/store/uiStore.ts`

- [ ] **Step 1: Write src/lib/store/uiStore.ts**

```typescript
import { create } from 'zustand';

interface UiState {
  isSidebarCollapsed: boolean;
  toggleSidebar: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  isSidebarCollapsed: false,
  toggleSidebar: () =>
    set((state) => ({ isSidebarCollapsed: !state.isSidebarCollapsed })),
}));
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/store
git commit -m "Add Zustand UI store for sidebar state"
```

---

### Task 13: Error boundary component

**Files:**
- Create: `src/components/ErrorBoundary.tsx`

- [ ] **Step 1: Write src/components/ErrorBoundary.tsx**

```typescript
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Unhandled renderer error', error, info);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div role="alert" style={{ padding: 24 }}>
          Something went wrong. Please restart OMNES.
        </div>
      );
    }

    return this.props.children;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ErrorBoundary.tsx
git commit -m "Add top-level renderer error boundary"
```

---

### Task 14: Splash screen component

**Files:**
- Create: `src/app/SplashScreen.module.css`
- Create: `src/app/SplashScreen.tsx`

- [ ] **Step 1: Write src/app/SplashScreen.module.css**

```css
.splash {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-4);
  background-color: var(--color-background);
}

.logo {
  width: 96px;
  height: 96px;
  object-fit: contain;
}

.status {
  margin: 0;
  color: var(--color-text-secondary);
  font-size: 0.875rem;
}
```

- [ ] **Step 2: Write src/app/SplashScreen.tsx**

```typescript
import { useTranslation } from 'react-i18next';
import logo from '@branding/logo-transparent.png';
import styles from './SplashScreen.module.css';

export function SplashScreen() {
  const { t } = useTranslation();

  return (
    <div className={styles.splash}>
      <img src={logo} alt="OMNES" className={styles.logo} />
      <p className={styles.status}>{t('shell.loading')}</p>
    </div>
  );
}
```

Note: component return types are left to inference (no `: JSX.Element` annotation). With the installed React 19 types, the global `JSX` namespace isn't auto-available under `"jsx": "react-jsx"` without an extra import, and inference already gives the same safety with less noise. This applies to every component in this plan (`SplashScreen`, `AppShell`, `Dashboard`, `App`).

- [ ] **Step 3: Commit**

```bash
git add src/app/SplashScreen.tsx src/app/SplashScreen.module.css
git commit -m "Add splash screen"
```

---

### Task 15: AppShell component, with a real render test

**Files:**
- Create: `tests/unit/AppShell.test.tsx`
- Create: `src/app/AppShell.module.css`
- Create: `src/app/AppShell.tsx`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import '../../src/lib/i18n';
import { AppShell } from '../../src/app/AppShell';

describe('AppShell', () => {
  it('lists all six modules in the sidebar', () => {
    render(
      <MemoryRouter>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<div>content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    const expectedLabels = [
      'Core',
      'Point of Sale',
      'Inventory',
      'Customers',
      'Reports',
      'Administration',
    ];

    for (const label of expectedLabels) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test`
Expected: FAIL — `Cannot find module '../../src/app/AppShell'`.

- [ ] **Step 3: Write src/app/AppShell.module.css**

```css
.shell {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.titlebar {
  height: 48px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: 0 var(--space-4);
  background-color: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
}

.brand {
  font-weight: 600;
  letter-spacing: 0.02em;
}

.version {
  color: var(--color-text-secondary);
  font-size: 0.75rem;
}

.body {
  flex: 1;
  display: flex;
  min-height: 0;
}

.sidebar {
  width: 220px;
  flex-shrink: 0;
  background-color: var(--color-surface);
  border-right: 1px solid var(--color-border);
  padding: var(--space-3);
}

.sidebar[data-collapsed='true'] {
  width: 64px;
}

.sidebar ul {
  list-style: none;
  margin: var(--space-3) 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.collapseButton {
  background: none;
  border: none;
  color: var(--color-text-secondary);
  cursor: pointer;
  border-radius: var(--radius-sm);
  padding: var(--space-1) var(--space-2);
}

.navItem {
  display: block;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-md);
  color: var(--color-text-primary);
}

.navItem[data-disabled='true'] {
  color: var(--color-text-secondary);
}

.content {
  flex: 1;
  overflow: auto;
  padding: var(--space-6);
}
```

- [ ] **Step 4: Write src/app/AppShell.tsx**

```typescript
import { useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useUiStore } from '../lib/store/uiStore';
import styles from './AppShell.module.css';

const MODULE_NAV = [
  { key: 'modules.core', enabled: true },
  { key: 'modules.pos', enabled: false },
  { key: 'modules.inventory', enabled: false },
  { key: 'modules.crm', enabled: false },
  { key: 'modules.reports', enabled: false },
  { key: 'modules.admin', enabled: false },
] as const;

export function AppShell() {
  const { t } = useTranslation();
  const [version, setVersion] = useState('');
  const isSidebarCollapsed = useUiStore((state) => state.isSidebarCollapsed);
  const toggleSidebar = useUiStore((state) => state.toggleSidebar);

  useEffect(() => {
    let cancelled = false;
    window.omnes?.getAppVersion().then((value) => {
      if (!cancelled) setVersion(value);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className={styles.shell}>
      <header className={styles.titlebar}>
        <span className={styles.brand}>{t('app.name')}</span>
        {version && <span className={styles.version}>v{version}</span>}
      </header>
      <div className={styles.body}>
        <nav className={styles.sidebar} data-collapsed={isSidebarCollapsed} aria-label="Modules">
          <button
            type="button"
            className={styles.collapseButton}
            onClick={toggleSidebar}
            aria-label="Toggle sidebar"
          >
            {isSidebarCollapsed ? '»' : '«'}
          </button>
          <ul>
            {MODULE_NAV.map((item) => (
              <li key={item.key}>
                <span className={styles.navItem} data-disabled={!item.enabled}>
                  {t(item.key)}
                </span>
              </li>
            ))}
          </ul>
        </nav>
        <main className={styles.content}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test`
Expected: PASS — all `AppShell` and `cn` tests passed.

- [ ] **Step 6: Commit**

```bash
git add tests/unit/AppShell.test.tsx src/app/AppShell.tsx src/app/AppShell.module.css
git commit -m "Add AppShell layout with module sidebar"
```

---

### Task 16: Dashboard placeholder and App root wiring

**Files:**
- Create: `src/modules/core/Dashboard.module.css`
- Create: `src/modules/core/Dashboard.tsx`
- Create: `src/app/App.tsx`
- Create: `src/main.tsx`
- Create: `src/index.html`

- [ ] **Step 1: Write src/modules/core/Dashboard.module.css**

```css
.empty {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-secondary);
}
```

- [ ] **Step 2: Write src/modules/core/Dashboard.tsx**

```typescript
import { useTranslation } from 'react-i18next';
import styles from './Dashboard.module.css';

export function Dashboard() {
  const { t } = useTranslation();

  return (
    <div className={styles.empty}>
      <p>{t('shell.comingSoon')}</p>
    </div>
  );
}
```

- [ ] **Step 3: Write src/app/App.tsx**

```typescript
import { useEffect, useState } from 'react';
import { HashRouter, Route, Routes } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { i18nReady } from '../lib/i18n';
import { SplashScreen } from './SplashScreen';
import { AppShell } from './AppShell';
import { Dashboard } from '../modules/core/Dashboard';

export function App() {
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    i18nReady.then(() => {
      if (!cancelled) setIsReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <ErrorBoundary>
      <AnimatePresence mode="wait">
        {!isReady ? (
          <motion.div key="splash" exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
            <SplashScreen />
          </motion.div>
        ) : (
          <motion.div
            key="shell"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.25 }}
            style={{ height: '100%' }}
          >
            <HashRouter>
              <Routes>
                <Route element={<AppShell />}>
                  <Route index element={<Dashboard />} />
                </Route>
              </Routes>
            </HashRouter>
          </motion.div>
        )}
      </AnimatePresence>
    </ErrorBoundary>
  );
}
```

- [ ] **Step 4: Write src/main.tsx**

```typescript
import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './app/App';
import './styles/global.css';

const queryClient = new QueryClient();

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
);
```

- [ ] **Step 5: Write src/index.html**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:;"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>OMNES</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 6: Verify typecheck and unit tests still pass**

Run: `pnpm typecheck && pnpm test`
Expected: zero errors, all unit tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/modules src/app/App.tsx src/main.tsx src/index.html
git commit -m "Wire renderer entry point with splash-to-shell transition"
```

---

### Task 17: Manual dev boot verification

**Files:** none (verification only)

- [ ] **Step 1: Run the dev server**

Run: `pnpm dev`
Expected: electron-vite starts the renderer dev server and launches an Electron window. Confirm in the window: the splash screen briefly shows the transparent logo, then the shell appears with a title bar reading "OMNES" and a version badge, a sidebar listing all six modules (only "Core" enabled-styled), and a "Coming soon" empty state in the content area.

- [ ] **Step 2: Check for console errors**

Open DevTools in the running window (Ctrl+Shift+I) and confirm the console has no errors.

- [ ] **Step 3: Stop the dev server**

Press `Ctrl+C` in the terminal running `pnpm dev`.

---

### Task 18: ESLint and Prettier configuration

**Files:**
- Create: `eslint.config.js`
- Create: `.prettierrc`
- Create: `.prettierignore`

- [ ] **Step 1: Write eslint.config.js**

```javascript
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['out', 'dist', 'release', 'node_modules'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      react,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
    settings: {
      react: { version: 'detect' },
    },
  },
  prettier,
);
```

- [ ] **Step 2: Write .prettierrc**

```json
{
  "semi": true,
  "singleQuote": true,
  "printWidth": 100,
  "trailingComma": "all"
}
```

- [ ] **Step 3: Write .prettierignore**

```
pnpm-lock.yaml
out
dist
release
```

- [ ] **Step 4: Run lint and fix formatting across the codebase**

Run: `pnpm lint`
Expected: reports any violations against the code written in Tasks 1-17.

Run: `pnpm format`
Then re-run: `pnpm lint`
Expected: zero errors, zero warnings.

- [ ] **Step 5: Commit**

```bash
git add eslint.config.js .prettierrc .prettierignore
git add -u
git commit -m "Add ESLint and Prettier configuration"
```

---

### Task 19: Husky and lint-staged pre-commit hook

**Files:**
- Create: `.husky/pre-commit`

- [ ] **Step 1: Initialize Husky**

Run: `pnpm husky`

- [ ] **Step 2: Write .husky/pre-commit**

```
npx lint-staged
```

- [ ] **Step 3: Verify the hook runs**

Run: `git commit --allow-empty -m "test: verify pre-commit hook"` then immediately `git reset HEAD~1`
Expected: `lint-staged` output appears before the commit completes (with no staged files it reports nothing to check and exits 0); the test commit is then removed.

- [ ] **Step 4: Commit**

```bash
git add .husky/pre-commit
git commit -m "Add Husky pre-commit hook running lint-staged"
```

---

### Task 20: electron-builder packaging sanity build

**Files:**
- Create: `electron-builder.yml`

- [ ] **Step 1: Write electron-builder.yml**

```yaml
appId: com.omnes.desktop
productName: OMNES
directories:
  output: release
files:
  - out/**/*
  - package.json
win:
  target: dir
asar: true
```

- [ ] **Step 2: Run the packaging sanity build**

Run: `pnpm package`
Expected: `electron-vite build` succeeds, then `electron-builder --dir` produces an unpacked app under `release/win-unpacked/` with no errors.

- [ ] **Step 3: Verify the packaged app launches**

Run: `./release/win-unpacked/OMNES.exe` (or the produced executable name), confirm the window opens showing the same shell as the dev build, then close it.

- [ ] **Step 4: Commit**

```bash
git add electron-builder.yml
git commit -m "Add electron-builder sanity packaging config"
```

---

### Task 21: Playwright end-to-end smoke test

**Files:**
- Create: `playwright.config.ts`
- Create: `tests/e2e/app.spec.ts`

- [ ] **Step 1: Write playwright.config.ts**

```typescript
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  retries: 0,
  reporter: 'list',
});
```

- [ ] **Step 2: Write tests/e2e/app.spec.ts**

```typescript
import path from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';

test('launches the shell and resolves the app version over IPC', async () => {
  const app = await electron.launch({
    args: [path.resolve(process.cwd(), 'out/main/index.mjs')],
  });

  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');

  await expect(window).toHaveTitle('OMNES');
  await expect(window.getByText('Core')).toBeVisible();
  await expect(window.getByText(/^v\d+\.\d+\.\d+$/)).toBeVisible();

  await app.close();
});
```

- [ ] **Step 3: Run the e2e test**

Run: `pnpm test:e2e`
Expected: PASS — the built app launches, the title, sidebar label, and IPC-sourced version badge are all visible.

- [ ] **Step 4: Commit**

```bash
git add playwright.config.ts tests/e2e
git commit -m "Add Playwright end-to-end smoke test"
```

---

### Task 22: GitHub Actions CI workflow

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Write .github/workflows/ci.yml**

```yaml
name: CI

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

jobs:
  build:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 9

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm

      - run: pnpm install --frozen-lockfile

      - run: pnpm lint

      - run: pnpm typecheck

      - run: pnpm test

      - run: pnpm build
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "Add CI workflow for lint, typecheck, test, and build"
```

---

### Task 23: Documentation

**Files:**
- Create: `README.md`
- Create: `docs/architecture.md`
- Create: `.env.example`

- [ ] **Step 1: Write .env.example**

```
# OMNES environment configuration
# No variables are required yet for the Foundation shell.
# DATABASE_URL and other secrets are added by later sub-projects
# (feature/database, feature/licensing, feature/mobile-money) and
# must only ever live in a local, untracked .env file.
```

- [ ] **Step 2: Write README.md**

```markdown
# OMNES

OMNES is a desktop business suite for small and mid-sized retailers,
starting with a production-grade point-of-sale and expanding into
inventory, CRM, reporting, and administration.

## Requirements

- Node.js 22 (see `.nvmrc`)
- pnpm 9+

## Getting started

\`\`\`bash
pnpm install
pnpm dev
\`\`\`

This starts the Electron app with hot reload on the renderer.

## Scripts

| Script              | Purpose                                          |
| -------------------- | ------------------------------------------------ |
| `pnpm dev`            | Run the app in development with hot reload       |
| `pnpm build`          | Build main, preload, and renderer for production |
| `pnpm typecheck`      | Type-check main, preload, and renderer           |
| `pnpm lint`           | Lint the codebase                                |
| `pnpm test`           | Run unit tests                                   |
| `pnpm test:e2e`       | Build, then run Playwright end-to-end tests      |
| `pnpm package`        | Produce an unpacked build via electron-builder   |

## Project status

This repository currently contains the application foundation: the
Electron/React/TypeScript shell, tooling, and CI. It does not yet include
a database, authentication, or any business modules — see
`docs/architecture.md` and `docs/superpowers/specs/` for what's built and
what's planned next.

## Documentation

- [Architecture](docs/architecture.md)
- [Design specs](docs/superpowers/specs/)
```

- [ ] **Step 3: Write docs/architecture.md**

```markdown
# Architecture

## Process layout

OMNES is an Electron app built with `electron-vite`, which coordinates
three separate builds from one config:

- `electron/main` — the main process: window lifecycle, security policy,
  logging, and IPC handler registration.
- `electron/preload` — a preload script that exposes a narrow, typed API
  (`window.omnes`) to the renderer via `contextBridge`. The renderer never
  gets direct access to Node or Electron APIs.
- `src` — the renderer, a React application.

## Security baseline

Every `BrowserWindow` is created with `contextIsolation: true`,
`nodeIntegration: false`, and `sandbox: true`. A restrictive
Content-Security-Policy is applied to all responses via
`session.defaultSession.webRequest.onHeadersReceived`, and mirrored in the
renderer's `index.html` as a meta tag for the initial load. External links
are routed through `shell.openExternal` rather than opened as new
`BrowserWindow`s.

## Service-layer boundary

`electron/main/services/` has one folder per business module (`core`,
`pos`, `inventory`, `crm`, `reports`, `admin`). IPC handlers in
`electron/main/ipc/` call into these service modules rather than
containing business logic themselves. This keeps main-process logic
testable independent of Electron, and is the seam a future REST/GraphQL
API or cloud sync layer would be built behind, without rewriting business
logic. These folders are empty until the modules that need them are
built.

## IPC contract

Types shared between main and renderer live in `shared/`, so both sides
import from one source of truth instead of duplicating request/response
shapes. `shared/ipc.ts` defines the channel names and the `AppApi` shape
the preload script implements and the renderer consumes via
`window.omnes`.

## Renderer structure

`src/app/` holds routing and shell layout (`App.tsx`, `AppShell.tsx`,
`SplashScreen.tsx`). `src/modules/` mirrors the six business modules on
the renderer side, matching the main-process service layout — each
module's UI lives in its own folder as it's built. `src/components/` holds
UI that's shared across modules. `src/lib/` holds cross-cutting
infrastructure: i18n setup, the Zustand UI store, and small utilities.

## Theming

`src/styles/tokens.css` defines a minimal dark-first token set (background,
surface, text, border, focus ring, spacing, radii) consumed via CSS
Modules. This is intentionally small — the full brand color palette
(primary/accent/success/warning/danger and chart colors, derived from the
OMNES logo) is designed in a later sub-project, not guessed at here.

## Internationalization

`src/lib/i18n.ts` wires `i18next` with English as the source of truth and
Kinyarwanda/French translations alongside it, loaded as static JSON under
`src/locales/`. Every user-facing string in the app goes through this
layer from the start; modules should never hardcode English text.

## Branding assets

`assets/branding/logo-full.png` and `assets/branding/logo-transparent.png`
are the canonical, versioned logo assets. The renderer reaches them via
the `@branding` alias configured in both `electron.vite.config.ts` and
`vitest.config.ts`.
```

- [ ] **Step 4: Commit**

```bash
git add README.md docs/architecture.md .env.example
git commit -m "Add README and architecture documentation"
```

---

### Task 24: Final integration check

**Files:** none (verification only)

- [ ] **Step 1: Run the full local verification suite**

Run:
```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```
Expected: every command exits 0.

- [ ] **Step 2: Push the branch**

Run: `git push -u origin feature/scaffold`
Expected: branch pushed to `origin`.

- [ ] **Step 3: Hand off for integration**

This plan ends here. Use the `superpowers:finishing-a-development-branch` skill to decide how `feature/scaffold` gets merged into `main` (PR vs. direct merge commit) now that it builds, lints, type-checks, and passes all tests.
