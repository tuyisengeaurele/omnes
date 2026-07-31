# Licensing — Design

Status: Approved
Date: 2026-07-29

## Purpose

OMNES is meant to be sold in tiers to independent businesses, not run as one
company's internal system. This sub-project builds the local, offline
license validation layer the master brief calls for: a signed license
file, verified entirely offline, that determines which feature tier is
active. It does not build online activation (explicitly deferred — the
validation source is architected to be swappable later, not built now),
and it does not build the licensing/settings UI a shop owner would use to
install a license file (that belongs to `feature/settings` or
`feature/administration`, once those exist) — this sub-project's UI
surface is limited to a read-only status badge, matching how Database
Foundation and Authentication each added one real, verifiable UI signal
rather than a full management screen.

Success criteria: a signed license file for a given tier can be generated
by a dev-tooling script, verified offline by the running app (rejecting
any tampering to the payload or an invalid signature), and the app's
active feature flags reflect that tier. With no license file present, the
app runs on a local "Development" tier rather than refusing to start —
every previous sub-project's ongoing development depends on the app
staying usable without a formal license, and that doesn't change here.

## Architecture

```
electron/main/services/core/
├── license.ts              # pure Node crypto: verify, tier → feature flags
└── license-public-key.ts   # embedded Ed25519 public key (not secret)
electron/main/ipc/
└── index.ts                  # + license:get-info handler
shared/
└── ipc.ts                    # + LicenseInfo, LicenseTier, Feature types
src/app/
└── AppShell.tsx               # + license tier badge, same pattern as version/DB badges
scripts/
└── generate-license.ts        # dev tooling: generate keypair, sign license files
keys/                           # gitignored — private key lives here, never committed
```

## Components

- **Keypair**: a single Ed25519 keypair, generated once by
  `scripts/generate-license.mjs` into `keys/` (gitignored). The public key
  is copied into `electron/main/services/core/license-public-key.ts` as a
  plain string constant — embedding it in source is correct, since a
  public key's job is to verify signatures, not keep anything secret.
  Losing the private key means no new licenses can ever be signed with
  that identity again, so `keys/` — while gitignored — is not disposable
  the way `.env` is; the person running this sub-project's tasks should
  understand that before regenerating it.
- **License file format**: JSON, `{ payload: { licenseId, customerName,
tier, issuedAt, expiresAt }, signature }`, where `signature` is a
  base64-encoded Ed25519 signature over the canonical JSON serialization
  of `payload`. `expiresAt` is optional (a perpetual license has none).
- **`license.ts`**: `verifyLicense(fileContents: string): LicenseInfo`
  parses the file, verifies the signature against the embedded public key,
  checks `expiresAt` if present, and returns a `LicenseInfo` — or throws,
  on any tampering, bad signature, malformed JSON, or expiry. Pure
  Node/crypto logic, no Electron import, unit-testable directly the same
  way `auth.ts` is.
- **`LocalFileValidator`**: reads a license file from a fixed path in the
  app's userData directory (`license.omneslicense`); if the file is
  missing, or `verifyLicense` throws, falls back to a hardcoded
  `DEVELOPMENT` tier `LicenseInfo` rather than propagating the error — this
  fallback is the one and only place "no valid license" is treated as
  non-fatal, everywhere else a rejected license is a real rejection.
- **Feature flags**: a `TIER_FEATURES: Record<LicenseTier, Feature[]>`
  table (`BASE` and `DEVELOPMENT` get everything currently built — there's
  no shipped module yet that a tier could sensibly exclude; add-on tiers
  and their gated features get filled in as those modules are built) and
  an `isFeatureEnabled(feature, license)` helper other modules will call.
- **IPC**: `license:get-info` returns the current `LicenseInfo` (tier,
  customer name if present, expiry if present) — never the raw file
  contents or anything about the signature itself.
- **UI**: `AppShell`'s titlebar gains a license tier badge, fetched the
  same `useEffect` + `window.omnes` pattern as the version and database
  badges.
- **Dev tooling**: `scripts/generate-license.mjs`, plain Node ESM (no
  TypeScript runner needed for a single standalone script), run directly
  via `node scripts/generate-license.mjs` (wrapped in a `pnpm license:*`
  script for convenience), supports generating the keypair once and
  signing a license file for a given tier/customer — this is the same tool
  a future real customer's license would be issued with, not a
  throwaway test fixture.

## Data flow

App startup → `LocalFileValidator.getActiveLicense()` → reads
`license.omneslicense` from userData if present → `verifyLicense()` →
`LicenseInfo` (or the `DEVELOPMENT` fallback) → cached in the main process
→ `license:get-info` IPC → renderer badge. `isFeatureEnabled()` is called
by future modules against this same cached `LicenseInfo`, not re-verified
per call.

## Error handling

- A present-but-invalid license file (bad signature, tampered payload,
  expired) is logged via electron-log with the specific reason, and the
  app falls back to `DEVELOPMENT` rather than crashing — a corrupted or
  expired license file shouldn't take down a shop's till.
- The dev-tooling script refuses to overwrite an existing keypair in
  `keys/` without an explicit `--force` flag, since regenerating it
  invalidates every license file already signed with the old key.

## Testing

- Unit tests for `license.ts`: a validly signed license verifies and
  returns the right tier; a tampered payload (same signature, different
  data) is rejected; an expired license is rejected; a missing/malformed
  file falls back to `DEVELOPMENT` via `LocalFileValidator`. All of this
  is deterministic, in-memory crypto — no database, no Electron runtime,
  fast.
- No new e2e assertion beyond the existing badge pattern — the tier badge
  gets the same "prove it renders after a real IPC round trip" check the
  version/database badges already have.

## Out of scope for this sub-project

Online activation/renewal (deferred per the master brief — only the
`LicenseValidator` seam is built, not a second implementation of it), a
license management UI for installing/viewing license files
(`feature/settings`/`feature/administration`), hardware/machine locking
(not requested, adds real complexity for a market where reinstalls and
hardware swaps are common — revisit only if piracy becomes a demonstrated
problem), per-module UI enforcement of feature flags (no gated modules
exist yet to enforce against), license renewal reminders
(`feature/notifications`).

## Git workflow

- Branch: `feature/licensing`, off `main`.
- Multiple small commits: keypair + public key embedding → license.ts +
  tests → LocalFileValidator → feature flag table → IPC → shell badge →
  dev-tooling script → manual verification across tiers → e2e.
- Merge to `main` via PR once verified locally and in CI.
