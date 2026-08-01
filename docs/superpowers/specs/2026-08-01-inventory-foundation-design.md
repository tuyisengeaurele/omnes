# Inventory Foundation — Design

Status: Approved
Date: 2026-08-01

## Purpose

Every business module past this point needs products to exist first — POS
sells them, Reports aggregates sales against them, CRM eventually ties
purchases to customers. This sub-project introduces the `Product` model and
a catalog CRUD screen, giving the Inventory sidebar entry (a disabled
placeholder since Foundation) real content for the first time. It's
deliberately scoped as the foundational slice of Inventory rather than
folded into POS itself, the same way Database Foundation preceded
Authentication — POS Sale Flow (cart, checkout, receipt, stock deduction)
is a separate, subsequent sub-project that consumes this one.

Full Inventory — purchase orders, suppliers, stock-adjustment audit trails,
low-stock alerts, multi-warehouse (an explicit license add-on feature
already defined in `shared/ipc.ts`) — is out of scope here. This sub-project
only builds what POS needs to have something to sell: a product record with
a name, a price, and a quantity on hand.

Success criteria: a shop owner can add a product with a name, SKU, price
(RWF, whole numbers — no commonly-used subunit), category, and starting
stock quantity; see all products in a list; edit any of those fields; and
deactivate a product without deleting its row (a future Sale record will
reference `productId`, which can't tolerate a hard-deleted product it once
sold).

## Architecture

```
prisma/schema.prisma           # + Product model and its migration
electron/main/services/core/
└── products.ts                  # pure-ish: Prisma CRUD against Product, no Electron import
electron/main/ipc/
└── index.ts                     # + product:list/create/update/setActive handlers
shared/
└── ipc.ts                       # + Product type, channels, AppApi
src/modules/inventory/
├── ProductsPage.tsx               # table + "Add product" entry point
├── ProductForm.tsx                 # shared add/edit form (React Hook Form + Zod)
└── ProductForm.schema.ts            # zod schema, shared between add and edit
src/app/
├── AppShell.tsx                    # Inventory nav item: enabled: false → true
└── App.tsx                          # + /inventory route
```

## Components

- **Data model** (`prisma/schema.prisma`): a new `Product` model — `id`
  (uuid), `name` (string), `sku` (string, `@unique`), `barcode` (string,
  optional, `@unique` when present — schema-level uniqueness on a nullable
  column allows any number of `null`s, which is what "not every product has
  a barcode yet" needs), `category` (plain string, not a separate lookup
  table — a dedicated `Category` model is unjustified complexity until a
  second module actually needs to query/filter by it, and adding one later
  is a straightforward migration), `price` (`Int`, RWF, no decimal places),
  `stockQuantity` (`Int`), `isActive` (`Boolean @default(true)` — the same
  soft-delete pattern `User.isActive` already established, for the same
  reason: history that references this row must survive its removal from
  the active catalog), `createdAt`/`updatedAt`.
- **`products.ts`**: thin CRUD functions directly against `prisma.product`
  — `listProducts()` (active products by default, matching what a cashier
  needs to see; an `includeInactive` flag for the catalog management screen
  itself), `createProduct()`, `updateProduct()`, `setProductActive(id,
isActive)`. Server-side validation mirrors `auth.ts`'s stance (never trust
  the renderer as the only validation layer): `name` non-empty, `sku`
  non-empty, `price >= 0`, `stockQuantity >= 0`. Duplicate `sku`/`barcode`
  surface Prisma's unique-constraint violation (`P2002`) as a clear "SKU
  already in use" / "Barcode already in use" error rather than a raw
  Prisma error crossing IPC. No Electron import, matching `auth.ts`'s
  testability against the real local database.
- **IPC**: `product:list` (optional `includeInactive` arg), `product:create`,
  `product:update` (id + partial fields), `product:setActive` (id, boolean)
  — thin wrappers over `products.ts`, following every prior sub-project's
  handler pattern.
- **UI**: `ProductsPage.tsx` lists products in a table (name, SKU, category,
  price, stock, active/inactive), with an "Add product" button opening
  `ProductForm.tsx` in create mode and a per-row "Edit" opening it in edit
  mode; a per-row toggle deactivates/reactivates rather than deleting.
  `AppShell`'s Inventory nav item flips to `enabled: true` and gets a real
  route, the same way Administration did for Backup.

## Data flow

Add: `ProductForm` (create mode) → `product:create` IPC → `products.ts`
validates and inserts → the page refetches `product:list` and re-renders.
Edit: same shape via `product:update`. Deactivate: a direct
`product:setActive` call from the row, no form involved, optimistic local
state update on success (matching `BackupPanel`'s established pattern for
per-row actions).

## Error handling

- Validation failures (empty name, negative price, etc.) are checked
  server-side in `products.ts` and returned as a clean error message
  crossing IPC, not a raw Prisma/validation exception — consistent with
  every prior service module.
- A duplicate `sku` or `barcode` (Prisma `P2002`) is caught and re-thrown
  as a specific, human-readable message identifying which field conflicted,
  not a generic "unique constraint failed" string.

## Testing

- `products.test.ts` runs real CRUD against the real local database
  (create, list, update, setActive, and the duplicate-SKU rejection path),
  matching the project's established "test real behavior" philosophy —
  there's no non-trivial algorithm here worth a separate pure-logic file
  the way `isBackupDue`/`isLicenseExpiringSoon` were; it's straightforward
  Prisma CRUD with validation, tested directly against Postgres.
- e2e: the Inventory nav item becomes reachable, a product can be added
  through the real form and appears in the list, following the same
  pattern as every prior sub-project's UI addition.

## Out of scope for this sub-project

Barcode scanner hardware integration (the `barcode` field exists so it can
be typed or pasted now and scanned later — no scanning UI yet), stock
adjustments with an audit trail (a raw `stockQuantity` edit through this
CRUD form is enough for now; a proper adjustment log with reasons is part
of full Inventory), purchase orders and suppliers, low-stock alerts (a
natural future consumer of the Notifications system built last
sub-project, once there's a real trigger condition to check), multi-
warehouse (an explicit license add-on, meaningless without multiple
locations existing as a concept yet), and product images (no product photo
field — nothing in the brief calls for it yet and it adds real storage/
packaging considerations better deferred until asked for).

## Git workflow

- Branch: `feature/inventory-foundation`, off `main`.
- Multiple small commits: Prisma model + migration → `products.ts` +
  tests → IPC wiring → Inventory route + `ProductsPage`/`ProductForm` → e2e.
- Merge to `main` via PR once verified locally and in CI.
