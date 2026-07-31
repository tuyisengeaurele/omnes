# Licensing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Offline, Ed25519-signed license files that determine a feature tier, with a `DEVELOPMENT` fallback when no license file is present — no online activation, no new runtime dependencies.

**Architecture:** `electron/main/services/core/license.ts` is pure Node `crypto` logic (no Electron import, unit-testable directly, matching `auth.ts`'s pattern) — signature verification, expiry checking, and the tier→feature-flag lookup. `license-store.ts` is the thin Electron-aware wrapper that reads the actual file from the app's userData directory and falls back to a `DEVELOPMENT` license, matching how `preferences.ts`/`idle.ts` wrap `auth.ts`. A standalone dev-tooling script (`scripts/generate-license.mjs`, plain Node, no build step) generates the keypair once and signs license files for testing — the same tool a real customer license would eventually be issued with.

**Tech Stack:** Node's built-in `crypto` module (Ed25519) — no new dependencies at all for this sub-project.

---

### Task 1: Dev-tooling script for keypair generation and license signing

**Files:**

- Create: `scripts/generate-license.mjs`
- Modify: `.gitignore`

- [ ] **Step 1: Write scripts/generate-license.mjs**

```javascript
#!/usr/bin/env node
import { generateKeyPairSync, sign, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const KEYS_DIR = path.resolve(import.meta.dirname, '../keys');
const PRIVATE_KEY_PATH = path.join(KEYS_DIR, 'license-private-key.pem');
const PUBLIC_KEY_PATH = path.join(KEYS_DIR, 'license-public-key.pem');

// Must match the canonicalize() in electron/main/services/core/license.ts
// exactly, or signatures produced here will fail to verify there.
function canonicalize(payload) {
  return JSON.stringify(payload, Object.keys(payload).sort());
}

function generateKeypair(force) {
  if (existsSync(PRIVATE_KEY_PATH) && !force) {
    console.error(
      `A keypair already exists at ${PRIVATE_KEY_PATH}. Pass --force to overwrite it ` +
        '(this invalidates every license already signed with it).',
    );
    process.exit(1);
  }

  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  mkdirSync(KEYS_DIR, { recursive: true });
  writeFileSync(PRIVATE_KEY_PATH, privateKey.export({ type: 'pkcs8', format: 'pem' }));
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  writeFileSync(PUBLIC_KEY_PATH, publicKeyPem);

  console.log(`Keypair written to ${KEYS_DIR}`);
  console.log('\nPaste this into electron/main/services/core/license-public-key.ts:\n');
  console.log(publicKeyPem);
}

function signLicense({ tier, addons, customerName, expiresAt, output }) {
  if (!existsSync(PRIVATE_KEY_PATH)) {
    console.error(`No private key found at ${PRIVATE_KEY_PATH}. Run "keygen" first.`);
    process.exit(1);
  }

  const privateKeyPem = readFileSync(PRIVATE_KEY_PATH, 'utf8');

  const payload = {
    licenseId: randomUUID(),
    customerName: customerName ?? null,
    tier,
    addons,
    issuedAt: new Date().toISOString(),
    expiresAt: expiresAt ?? null,
  };

  const payloadBytes = Buffer.from(canonicalize(payload));
  const signature = sign(null, payloadBytes, privateKeyPem).toString('base64');

  writeFileSync(output, JSON.stringify({ payload, signature }, null, 2));
  console.log(`License written to ${output}`);
}

function getArg(args, name, fallback) {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : args[index + 1];
}

const [, , command, ...args] = process.argv;

if (command === 'keygen') {
  generateKeypair(args.includes('--force'));
} else if (command === 'sign') {
  signLicense({
    tier: getArg(args, 'tier', 'BASE'),
    addons: (getArg(args, 'addons', '') || '').split(',').filter(Boolean),
    customerName: getArg(args, 'customer', null),
    expiresAt: getArg(args, 'expires', null),
    output: getArg(args, 'output', 'license.omneslicense'),
  });
} else {
  console.log('Usage:');
  console.log('  node scripts/generate-license.mjs keygen [--force]');
  console.log(
    '  node scripts/generate-license.mjs sign --tier BASE [--addons crm,reports_advanced] ' +
      '[--customer "Acme Shop"] [--expires 2027-01-01T00:00:00.000Z] [--output license.omneslicense]',
  );
  process.exit(1);
}
```

Run directly with `node`, not through a `pnpm run` script with passed-through arguments — `pnpm run <script> -- <args>` was already found (in the authentication sub-project) to pass a literal `--` through instead of stripping it on this pnpm version, which would break the `sign` subcommand's argument parsing the same way it broke `prisma migrate dev --name`. Direct `node scripts/generate-license.mjs sign --tier BASE ...` invocation has no such problem.

- [ ] **Step 2: Update .gitignore**

Add to `.gitignore`:

```
keys/
*.omneslicense
```

`keys/` holds the private key — losing it means no new licenses can ever be signed with that identity again, so treat it as more precious than `.env` (which is trivially regeneratable), not less, even though both are gitignored the same way. `*.omneslicense` keeps test/dev license files signed at the repo root out of version control.

- [ ] **Step 3: Create the branch and verify the script runs**

```bash
git checkout main
git pull
git checkout -b feature/licensing
```

Run: `node scripts/generate-license.mjs`
Expected: prints the usage message (no command given) and exits 1 — confirms the script itself has no syntax errors before relying on it in the next task.

- [ ] **Step 4: Fix eslint.config.js for plain JS/mjs files**

Run: `pnpm lint`
Expected: fails with 14 `no-undef` errors on `console`/`process`/`Buffer` inside `generate-license.mjs`. This is real, not a false positive — `eslint.config.js`'s `js.configs.recommended` block has no Node globals declared, and every `.ts` file so far has been shielded from this because `tseslint.configs.recommended` effectively disables `no-undef` for TypeScript files (relying on `tsc` to catch undefined references instead) — a plain `.mjs` file isn't covered by that override and hits the base rule directly.

In `eslint.config.js`, add a new block (before the existing `files: ['**/*.{ts,tsx}']` block):

```javascript
  {
    // Plain JS/mjs files (standalone dev scripts) aren't covered by the
    // TypeScript-aware block below, so they need Node globals declared
    // explicitly or `no-undef` flags console/process/Buffer as unknown.
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        module: 'readonly',
        require: 'readonly',
      },
    },
  },
```

Re-run: `pnpm lint`
Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add scripts/generate-license.mjs .gitignore eslint.config.js
git commit -m "Add license keypair generation and signing script"
```

---

### Task 2: Generate the real keypair and embed the public key

**Files:**

- Create: `electron/main/services/core/license-public-key.ts`

- [ ] **Step 1: Generate the keypair**

Run: `node scripts/generate-license.mjs keygen`
Expected: writes `keys/license-private-key.pem` and `keys/license-public-key.pem` (both gitignored, confirmed by Task 1), and prints the public key PEM to the terminal.

This is a one-time, non-deterministic step — the actual key bytes can't be written into this plan ahead of time. Whoever runs this task gets a different real keypair than anyone else who ever ran it before.

- [ ] **Step 2: Write electron/main/services/core/license-public-key.ts**

Paste the exact PEM printed in Step 1 into this file:

```typescript
export const LICENSE_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
<paste the real base64 lines printed by Step 1 here, unchanged>
-----END PUBLIC KEY-----
`;
```

Embedding a public key in source is correct and safe — its only job is to verify signatures, not keep anything secret.

- [ ] **Step 3: Verify typecheck**

Run: `pnpm typecheck`
Expected: zero errors (this file has no other dependencies yet).

- [ ] **Step 4: Commit**

```bash
git add electron/main/services/core/license-public-key.ts
git commit -m "Embed the license verification public key"
```

---

### Task 3: Shared license types

**Files:**

- Modify: `shared/ipc.ts`

- [ ] **Step 1: Replace shared/ipc.ts with its full updated content**

```typescript
export const IPC_CHANNELS = {
  getAppVersion: 'app:get-version',
  checkDatabaseHealth: 'database:health-check',
  hasUsers: 'auth:has-users',
  createFirstAdmin: 'auth:create-first-admin',
  login: 'auth:login',
  logout: 'auth:logout',
  unlock: 'auth:unlock',
  getSession: 'auth:get-session',
  getLastUsername: 'auth:get-last-username',
  sessionLocked: 'session:locked',
  getLicenseInfo: 'license:get-info',
} as const;

export interface DatabaseHealthResult {
  connected: boolean;
}

export type Role = 'ADMIN' | 'MANAGER' | 'CASHIER';

export interface Session {
  userId: string;
  username: string;
  role: Role;
  loginAt: string;
  isLocked: boolean;
}

export type LicenseTier = 'DEVELOPMENT' | 'BASE';

export type Feature =
  | 'pos'
  | 'inventory'
  | 'receipts'
  | 'reports_basic'
  | 'administration'
  | 'mobile_money'
  | 'crm'
  | 'loyalty'
  | 'store_credit'
  | 'reports_advanced'
  | 'multi_warehouse';

export interface LicenseInfo {
  licenseId: string;
  customerName: string | null;
  tier: LicenseTier;
  addons: Feature[];
  issuedAt: string;
  expiresAt: string | null;
}

export interface AppApi {
  getAppVersion: () => Promise<string>;
  checkDatabaseHealth: () => Promise<DatabaseHealthResult>;
  hasUsers: () => Promise<boolean>;
  createFirstAdmin: (username: string, password: string) => Promise<Session>;
  login: (username: string, password: string) => Promise<Session>;
  logout: () => Promise<void>;
  unlock: (password: string) => Promise<Session>;
  getSession: () => Promise<Session | null>;
  getLastUsername: () => Promise<string | null>;
  onSessionLocked: (callback: () => void) => () => void;
  getLicenseInfo: () => Promise<LicenseInfo>;
}
```

The `Feature` union already includes the add-on features (`crm`, `loyalty`, `store_credit`, `reports_advanced`, `multi_warehouse`) from the master brief's packaging tiers even though no module gates on them yet — this is the seam those later sub-projects plug into, not speculative extra scope, since the type itself has no behavior until `isFeatureEnabled` (Task 4) is actually called somewhere.

- [ ] **Step 2: Verify typecheck**

Run: `pnpm typecheck`
Expected: fails — `electron/preload/index.ts` and `electron/main/ipc/index.ts` don't implement `getLicenseInfo` yet (fixed in Task 6). Confirm the failure is specifically that missing member, not a syntax error in this file.

- [ ] **Step 3: Commit**

```bash
git add shared/ipc.ts
git commit -m "Add license types to the shared IPC contract"
```

---

### Task 4: License verification logic, with real unit tests (TDD)

**Files:**

- Create: `tests/unit/license.test.ts`
- Create: `electron/main/services/core/license.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// @vitest-environment node
import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  getDevelopmentLicense,
  isFeatureEnabled,
  verifyLicense,
} from '../../electron/main/services/core/license';
import type { LicenseInfo } from '../../shared/ipc';

// Must match canonicalize() in electron/main/services/core/license.ts —
// these tests sign their own throwaway keypair, they never touch the real
// embedded production key or keys/.
function canonicalize(payload: unknown): string {
  return JSON.stringify(payload, Object.keys(payload as Record<string, unknown>).sort());
}

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const testPublicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();

function signTestLicense(payload: Record<string, unknown>, signingKey = privateKey): string {
  const payloadBytes = Buffer.from(canonicalize(payload));
  const signature = sign(null, payloadBytes, signingKey).toString('base64');
  return JSON.stringify({ payload, signature });
}

const BASE_PAYLOAD = {
  licenseId: 'test-license-1',
  customerName: 'Test Shop',
  tier: 'BASE',
  addons: [],
  issuedAt: new Date().toISOString(),
  expiresAt: null,
};

describe('verifyLicense', () => {
  it('verifies a validly signed license', () => {
    const fileContents = signTestLicense(BASE_PAYLOAD);

    const result = verifyLicense(fileContents, testPublicKeyPem);

    expect(result.licenseId).toBe('test-license-1');
    expect(result.tier).toBe('BASE');
    expect(result.customerName).toBe('Test Shop');
  });

  it('rejects a tampered payload', () => {
    const fileContents = signTestLicense(BASE_PAYLOAD);
    const tampered = JSON.parse(fileContents);
    tampered.payload.addons = ['crm'];

    expect(() => verifyLicense(JSON.stringify(tampered), testPublicKeyPem)).toThrow(
      'signature is invalid',
    );
  });

  it('rejects a license signed with a different key', () => {
    const otherKeypair = generateKeyPairSync('ed25519');
    const fileContents = signTestLicense(BASE_PAYLOAD, otherKeypair.privateKey);

    expect(() => verifyLicense(fileContents, testPublicKeyPem)).toThrow('signature is invalid');
  });

  it('rejects an expired license', () => {
    const expiredPayload = { ...BASE_PAYLOAD, expiresAt: new Date(0).toISOString() };
    const fileContents = signTestLicense(expiredPayload);

    expect(() => verifyLicense(fileContents, testPublicKeyPem)).toThrow('expired');
  });

  it('rejects malformed JSON', () => {
    expect(() => verifyLicense('not json', testPublicKeyPem)).toThrow('not valid JSON');
  });

  it('rejects a file missing payload or signature', () => {
    expect(() =>
      verifyLicense(JSON.stringify({ payload: BASE_PAYLOAD }), testPublicKeyPem),
    ).toThrow('missing payload or signature');
  });
});

describe('isFeatureEnabled', () => {
  it('the development license has every feature enabled', () => {
    expect(isFeatureEnabled('crm', getDevelopmentLicense())).toBe(true);
    expect(isFeatureEnabled('multi_warehouse', getDevelopmentLicense())).toBe(true);
  });

  it('a base license has base features but not add-ons', () => {
    const license: LicenseInfo = {
      licenseId: 'x',
      customerName: null,
      tier: 'BASE',
      addons: [],
      issuedAt: '',
      expiresAt: null,
    };

    expect(isFeatureEnabled('pos', license)).toBe(true);
    expect(isFeatureEnabled('crm', license)).toBe(false);
  });

  it('a base license with an add-on has that add-on enabled', () => {
    const license: LicenseInfo = {
      licenseId: 'x',
      customerName: null,
      tier: 'BASE',
      addons: ['crm'],
      issuedAt: '',
      expiresAt: null,
    };

    expect(isFeatureEnabled('crm', license)).toBe(true);
    expect(isFeatureEnabled('loyalty', license)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test`
Expected: FAIL — `Cannot find module '../../electron/main/services/core/license'`.

- [ ] **Step 3: Write electron/main/services/core/license.ts**

```typescript
import { createPublicKey, verify } from 'node:crypto';
import { LICENSE_PUBLIC_KEY_PEM } from './license-public-key';
import type { Feature, LicenseInfo, LicenseTier } from '@shared/ipc';

interface LicensePayload {
  licenseId: string;
  customerName: string | null;
  tier: LicenseTier;
  addons: Feature[];
  issuedAt: string;
  expiresAt: string | null;
}

interface LicenseFile {
  payload: LicensePayload;
  signature: string;
}

// Must match canonicalize() in scripts/generate-license.mjs exactly, or
// signatures produced by that script will fail to verify here.
function canonicalize(payload: LicensePayload): string {
  return JSON.stringify(payload, Object.keys(payload).sort());
}

export function verifyLicense(
  fileContents: string,
  publicKeyPem: string = LICENSE_PUBLIC_KEY_PEM,
): LicenseInfo {
  let parsed: LicenseFile;
  try {
    parsed = JSON.parse(fileContents) as LicenseFile;
  } catch {
    throw new Error('License file is not valid JSON');
  }

  if (!parsed.payload || !parsed.signature) {
    throw new Error('License file is missing payload or signature');
  }

  const publicKey = createPublicKey(publicKeyPem);
  const payloadBytes = Buffer.from(canonicalize(parsed.payload));
  const signatureBytes = Buffer.from(parsed.signature, 'base64');

  const isValid = verify(null, payloadBytes, publicKey, signatureBytes);
  if (!isValid) {
    throw new Error('License signature is invalid');
  }

  if (parsed.payload.expiresAt && new Date(parsed.payload.expiresAt).getTime() < Date.now()) {
    throw new Error('License has expired');
  }

  return {
    licenseId: parsed.payload.licenseId,
    customerName: parsed.payload.customerName,
    tier: parsed.payload.tier,
    addons: parsed.payload.addons,
    issuedAt: parsed.payload.issuedAt,
    expiresAt: parsed.payload.expiresAt,
  };
}

const DEVELOPMENT_LICENSE: LicenseInfo = {
  licenseId: 'development',
  customerName: null,
  tier: 'DEVELOPMENT',
  addons: [],
  issuedAt: new Date(0).toISOString(),
  expiresAt: null,
};

export function getDevelopmentLicense(): LicenseInfo {
  return DEVELOPMENT_LICENSE;
}

const BASE_FEATURES: Feature[] = [
  'pos',
  'inventory',
  'receipts',
  'reports_basic',
  'administration',
  'mobile_money',
];

export function isFeatureEnabled(feature: Feature, license: LicenseInfo): boolean {
  if (license.tier === 'DEVELOPMENT') {
    return true;
  }
  return BASE_FEATURES.includes(feature) || license.addons.includes(feature);
}
```

This file imports nothing from `electron` — only `node:crypto`, the embedded public key constant, and shared types. `verifyLicense`'s `publicKeyPem` parameter defaults to the real embedded key for production use, but lets tests pass their own throwaway keypair instead of needing access to the real private key in `keys/`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test`
Expected: PASS — all 9 new `license` tests, plus every pre-existing test.

- [ ] **Step 5: Verify typecheck**

Run: `pnpm typecheck`
Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add tests/unit/license.test.ts electron/main/services/core/license.ts
git commit -m "Add license verification logic and feature-flag lookup"
```

---

### Task 5: License store (Electron-aware wrapper)

**Files:**

- Create: `electron/main/services/core/license-store.ts`

- [ ] **Step 1: Write electron/main/services/core/license-store.ts**

```typescript
import { app } from 'electron';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import log from 'electron-log/main';
import { getDevelopmentLicense, verifyLicense } from './license';
import type { LicenseInfo } from '@shared/ipc';

let cachedLicense: LicenseInfo | null = null;

function loadLicenseFromDisk(): LicenseInfo {
  const licensePath = path.join(app.getPath('userData'), 'license.omneslicense');

  let fileContents: string;
  try {
    fileContents = readFileSync(licensePath, 'utf8');
  } catch {
    return getDevelopmentLicense();
  }

  try {
    return verifyLicense(fileContents);
  } catch (error) {
    log.warn('License file present but invalid, falling back to development license', error);
    return getDevelopmentLicense();
  }
}

export function getActiveLicense(): LicenseInfo {
  cachedLicense ??= loadLicenseFromDisk();
  return cachedLicense;
}
```

The license is read once and cached for the process lifetime — same reasoning as the session state in `auth.ts`, and it means installing a new license file requires an app restart to take effect (acceptable; there's no UI yet for installing one without restarting anyway).

- [ ] **Step 2: Verify typecheck**

Run: `pnpm typecheck`
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add electron/main/services/core/license-store.ts
git commit -m "Add license store that falls back to a development license"
```

---

### Task 6: Wire the license IPC channel

**Files:**

- Modify: `electron/preload/index.ts`
- Modify: `electron/main/ipc/index.ts`

- [ ] **Step 1: Add getLicenseInfo to electron/preload/index.ts**

Add to the `api` object in `electron/preload/index.ts`:

```typescript
  getLicenseInfo: () => ipcRenderer.invoke(IPC_CHANNELS.getLicenseInfo),
```

- [ ] **Step 2: Add the handler to electron/main/ipc/index.ts**

Add the import:

```typescript
import { getActiveLicense } from '../services/core/license-store';
```

Add inside `registerIpcHandlers()`:

```typescript
ipcMain.handle(IPC_CHANNELS.getLicenseInfo, (): LicenseInfo => getActiveLicense());
```

And add `LicenseInfo` to the existing `@shared/ipc` type import at the top of the file.

- [ ] **Step 3: Verify typecheck**

Run: `pnpm typecheck`
Expected: zero errors — this is what makes Task 3's expected failure go away.

- [ ] **Step 4: Commit**

```bash
git add electron/preload/index.ts electron/main/ipc/index.ts
git commit -m "Wire the license info IPC channel"
```

---

### Task 7: License tier badge in the shell

**Files:**

- Modify: `src/locales/en.json`, `src/locales/rw.json`, `src/locales/fr.json`
- Modify: `src/app/AppShell.tsx`
- Modify: `src/app/AppShell.module.css`

- [ ] **Step 1: Add the "License" locale key to all three locale files**

Add `"shell.license": "License"` to `src/locales/en.json` (alongside the existing `shell.*` keys).
Add `"shell.license": "Icyemezo"` to `src/locales/rw.json`.
Add `"shell.license": "Licence"` to `src/locales/fr.json`.

The tier value itself (`BASE`, `DEVELOPMENT`) is not translated — it's a technical identifier, the same way a SKU or plan code wouldn't be, not a piece of prose.

- [ ] **Step 2: Add state and an effect to AppShell.tsx**

Add alongside the existing `isDatabaseConnected` state:

```typescript
const [licenseTier, setLicenseTier] = useState<string | null>(null);
```

Add a third effect, following the same pattern as the version and database-health effects:

```typescript
useEffect(() => {
  let cancelled = false;
  window.omnes
    ?.getLicenseInfo()
    .then((info) => {
      if (!cancelled) setLicenseTier(info.tier);
    })
    .catch((error: unknown) => {
      console.error('Failed to read license info', error);
    });
  return () => {
    cancelled = true;
  };
}, []);
```

Add the badge in the titlebar, after the database-status span and before the `userControls` div:

```tsx
{
  licenseTier && (
    <span className={styles.licenseTier}>
      {t('shell.license')}: {licenseTier}
    </span>
  );
}
```

- [ ] **Step 3: Add the CSS class**

In `src/app/AppShell.module.css`, add:

```css
.licenseTier {
  color: var(--color-text-secondary);
  font-size: 0.75rem;
}
```

- [ ] **Step 4: Verify typecheck, lint, and existing unit tests**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: zero errors, all pre-existing tests still pass — `AppShell.test.tsx` renders `AppShell` with no `window.omnes`, so `licenseTier` stays `null` and the badge simply doesn't render, same as the database-status badge's existing test behavior.

- [ ] **Step 5: Commit**

```bash
git add src/locales src/app/AppShell.tsx src/app/AppShell.module.css
git commit -m "Add license tier badge to the shell"
```

---

### Task 8: Manual verification across license states

**Files:** none (verification only)

**A userData-path gotcha, worth knowing before you conclude the wrong thing is broken:** the most deterministic way to drive these scenarios is the same Playwright Electron harness Task 9's e2e test and every prior sub-project's manual verification used — launch `out/main/index.js` directly via `electron.launch({ args: [...] })` in a throwaway script. But launched that way (a bare script path, not through `pnpm dev`'s normal electron-vite invocation, and not through a real packaged install), Electron cannot determine the app's identity from `package.json` and falls back to its generic default name, `"Electron"` — so `app.getPath('userData')` resolves to `%APPDATA%\Electron`, **not** `%APPDATA%\omnes`. This was found by adding a temporary debug log to `license-store.ts`, rebuilding, and tracing the actual path Electron used — not assumed. It's a test-harness artifact, not a production bug: a real packaged install (built via `pnpm package`, Foundation's electron-builder config) gets its correct identity from `productName: OMNES` and resolves userData correctly. `pnpm dev` also resolves it correctly (electron-vite's dev invocation preserves the app identity). Only this specific "launch a bare script path" pattern hits the fallback — but that's exactly the pattern used here and in Task 9, so use `%APPDATA%\Electron\license.omneslicense` for every step below, not `%APPDATA%\omnes\license.omneslicense`.

- [ ] **Step 1: Build and confirm the development fallback with no license file**

```bash
pnpm build
```

Write a throwaway script (do not commit it), e.g. `debug-license.mjs`, that launches `out/main/index.js` via `electron.launch()`, creates a first-admin account if none exists (or logs in if one does — sessions don't persist across process launches), then evaluates `window.omnes.getLicenseInfo()` and reads the rendered `License: ...` text from the DOM. Run it.

Expected: `{"licenseId":"development","tier":"DEVELOPMENT",...}` and the shell shows `License: DEVELOPMENT` — no license file exists anywhere yet.

- [ ] **Step 2: Sign a real BASE license and confirm it's picked up**

```bash
mkdir -p "$APPDATA/Electron"
node scripts/generate-license.mjs sign --tier BASE --customer "Test Shop" --output "$APPDATA/Electron/license.omneslicense"
```

Run the debug script again.
Expected: `getLicenseInfo()` now returns the real signed payload (`tier: "BASE"`, `customerName: "Test Shop"`, a real `licenseId`) and the shell shows `License: BASE` — a real signature verification against the real embedded public key, not a mock.

- [ ] **Step 3: Confirm a tampered license falls back gracefully**

Edit `$APPDATA/Electron/license.omneslicense`: change any value inside `"payload"` (e.g. `"customerName"`), leaving `"signature"` untouched.

Run the debug script again.
Expected: `getLicenseInfo()` returns `tier: "DEVELOPMENT"` again (not a crash, not `BASE`) — confirms the fallback path in `license-store.ts` actually triggers on a real invalid signature, not just in the unit tests. Check `$APPDATA/Electron/logs/main.log` for a `[warn]` line: `License file present but invalid, falling back to development license Error: License signature is invalid`.

- [ ] **Step 4: Clean up**

```bash
rm "$APPDATA/Electron/license.omneslicense"
rm debug-license.mjs
```

Leaving a stray license file in this userData directory would make Task 9's e2e test (which uses the same launch pattern and expects `DEVELOPMENT`) fail confusingly. Nothing from this task gets committed — it's a verification step, not a deliverable, the same way Foundation's Task 17 and Database Foundation's Task 10 weren't.

---

### Task 9: Extend the Playwright e2e test

**Files:**

- Modify: `tests/e2e/app.spec.ts`

- [ ] **Step 1: Add the license badge assertion**

In the `'bootstraps the first admin account and reaches the shell'` test, add alongside the existing post-login assertions:

```typescript
await expect(window.getByText('License: DEVELOPMENT')).toBeVisible({ timeout: 10_000 });
```

The e2e test always runs against a freshly built app with no license file installed in its (test-run-specific) userData directory, so `DEVELOPMENT` is the correct, deterministic expectation here — unlike the database-status badge, there's no environment-dependent "either connected or offline" ambiguity to account for.

- [ ] **Step 2: Run the e2e tests**

Run: `pnpm test:e2e`
Expected: both tests PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/app.spec.ts
git commit -m "Extend e2e test to verify the license badge renders"
```

---

### Task 10: Final integration check

**Files:** none (verification only)

- [ ] **Step 1: Run the full local verification suite**

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm package
```

Expected: every command exits 0.

- [ ] **Step 2: Push the branch and open a PR**

```bash
git push -u origin feature/licensing
```

- [ ] **Step 3: Verify CI passes on GitHub**

Open the PR, confirm the Actions run passes. This sub-project adds no database migration and no new dependency, so CI's shape is unchanged from the authentication sub-project — this is a lower-risk verification than the last two, but still worth confirming rather than assuming.

- [ ] **Step 4: Hand off for integration**

Use the `superpowers:finishing-a-development-branch` skill once CI is green.
