# POS Sale Flow — Design

Status: Approved
Date: 2026-08-01

## Purpose

This is the first sub-project to give the POS sidebar entry (a disabled
placeholder since Foundation) real content, and the first module that
actually sells the products Inventory Foundation introduced. A cashier
needs to build a cart from the product catalog, take payment (cash or
mobile money), and get a receipt — with stock deducted correctly and no
way to oversell a product that's run out.

Success criteria: a cashier can search the catalog, build a cart, adjust
quantities, checkout with cash (entering amount tendered, seeing change
calculated) or mobile money, and complete a sale that atomically deducts
stock and records the transaction; two near-simultaneous sales for the
last unit of a product can't both succeed; a completed sale shows an
on-screen receipt with a working "Print" button; a cashier can find and
reopen a recent sale's receipt without leaving POS.

## Architecture

```
prisma/schema.prisma              # + Sale, SaleItem models, PaymentMethod enum
electron/main/services/core/
└── sales.ts                        # Prisma CRUD + the checkout transaction
electron/main/ipc/
└── index.ts                        # + sale:create/list/get handlers
shared/
└── ipc.ts                          # + Sale, SaleItem types, channels, AppApi
src/modules/pos/
├── PosPage.tsx                       # layout: catalog search + cart side by side
├── ProductSearch.tsx                  # search-as-you-type against Product
├── Cart.tsx                            # line items, quantity, remove, total
├── CheckoutPanel.tsx                    # payment method, amount tendered, confirm
├── ReceiptView.tsx                       # on-screen receipt + Print button
└── SaleHistory.tsx                        # recent sales list, reopen a receipt
src/app/
├── AppShell.tsx                          # POS nav item: enabled: false → true
└── App.tsx                                # + /pos route
```

## Components

- **Data model**: `Sale` — `id`, `cashierId` (nullable, `onDelete:
SetNull`, mirroring `AuditLog.userId`), `cashierUsername` (snapshot, same
  reasoning as `AuditLog.username` — a deleted user shouldn't erase which
  name rang up a sale), `paymentMethod` (`CASH` | `MOBILE_MONEY` enum),
  `amountTendered` (`Int?`, cash only), `changeGiven` (`Int?`, cash only),
  `total` (`Int`, RWF), `createdAt`. `SaleItem` — `id`, `saleId` (`onDelete:
Cascade` — a sale's line items have no independent meaning without their
  parent sale), `productId` (nullable, `onDelete: SetNull` — a sale must
  survive a product being deactivated or, eventually, deleted),
  `productName` and `unitPrice` (snapshots at time of sale, same reasoning
  as the cashier snapshot — a later product rename or price change must
  never rewrite a historical receipt), `quantity`.
- **`sales.ts`**: `createSale(input)` runs the entire checkout inside one
  `prisma.$transaction`: re-reads current `stockQuantity` for every cart
  line (never trusts a stock count the renderer already has, which could
  be stale by the time checkout is pressed), rejects the whole sale with a
  clear "X is out of stock" style message if any line would go negative,
  otherwise decrements each product's stock, creates the `Sale` and its
  `SaleItem` rows, and returns the created sale. This is the same class of
  fix as `createFirstAdmin`'s TOCTOU race — a plain
  check-then-decrement without a transaction lets two concurrent
  checkouts both observe sufficient stock and both succeed, overselling
  the last unit. `listSales()` and `getSale(id)` are straightforward reads
  for `SaleHistory`/`ReceiptView`. Returns `SaleResult`-shaped values
  (`{ success, message, sale }`) from `createSale`, matching
  `products.ts`'s convention rather than throwing, so the IPC handler stays
  a thin passthrough.
- **IPC**: `sale:create`, `sale:list`, `sale:get` (id) — thin wrappers,
  following every prior sub-project's pattern.
- **UI**: `PosPage.tsx` is the two-pane layout — `ProductSearch.tsx` /
  catalog on one side, `Cart.tsx` on the other. Adding a product to the
  cart is a local-state-only operation (no IPC call) until checkout — the
  cart itself isn't persisted mid-build, only the final completed sale is.
  `CheckoutPanel.tsx` collects the payment method and (for cash) the
  amount tendered, computing change client-side for immediate feedback,
  then calls `sale:create` on confirm. On success, `ReceiptView.tsx` shows
  the completed sale with a "Print" button
  (`window.print()`/`webContents.print()` — the OS print dialog, not a
  vendor SDK). `SaleHistory.tsx` lists recent sales with a way to reopen
  `ReceiptView` for any of them. POS's nav item flips `enabled: true`, the
  same way Administration and Inventory did for their sub-projects.

## Data flow

Cart building is pure renderer state (an array of `{ product, quantity }`
in `PosPage.tsx`) — no IPC round trip per item added, since nothing needs
to be persisted until the sale actually completes. Checkout: `CheckoutPanel`
→ `sale:create` IPC (cart lines + payment method + amount tendered) →
`sales.ts`'s transaction → on success, the renderer clears its local cart
state and shows `ReceiptView` for the returned sale; on failure (e.g. an
item went out of stock between adding to cart and checkout), the error
message is shown and the cart stays intact so the cashier can adjust and
retry. `SaleHistory` calls `sale:list` on mount and `sale:get` when
reopening a specific receipt.

## Error handling

- Every stock/validation failure inside the checkout transaction produces
  a specific, human-readable message (which product, why) rather than a
  generic failure — the cashier needs to know exactly what to fix in the
  cart.
- A transaction failure leaves the database exactly as it was before
  checkout was attempted (Prisma's `$transaction` rolls back entirely on
  any thrown error inside it) — no partial stock deduction, no orphaned
  `Sale` row without its items.

## Testing

- `sales.test.ts` runs the real checkout transaction against the real
  local database: a successful sale deducts stock correctly, an
  insufficient-stock cart is rejected with the stock left unchanged, and a
  concurrency test (matching `auth.test.ts`'s `createFirstAdmin` race
  test) fires two simultaneous checkouts for a product with only one unit
  in stock and asserts exactly one succeeds — this is the property the
  whole transaction design exists to guarantee, so it needs to be proven,
  not assumed.
- e2e: search for a product, add it to the cart, complete a cash checkout,
  and confirm the receipt appears and the product's stock decreased by the
  purchased quantity (checked via the Inventory page, proving the
  cross-module effect is real, not just a UI illusion).

## Out of scope for this sub-project

Discounts (per-item or per-sale), refunds and voided sales, split
payments across multiple methods, held/parked transactions (start a sale,
suspend it, resume later), barcode scanner hardware integration (`Product
.barcode` already exists for typed/pasted entry; POS's search box accepts
it as plain text — no scanner SDK), cash-drawer reconciliation/till
counting, and license feature-gating (`isFeatureEnabled('pos', ...)`
exists from Licensing but nothing has ever called it yet — this
sub-project doesn't become the first to enforce it without a concrete
reason to).

## Git workflow

- Branch: `feature/pos-sale-flow`, off `main`.
- Multiple small commits: `Sale`/`SaleItem` models + migration →
  `sales.ts` (including the transactional checkout) + tests (including the
  concurrency test) → IPC wiring → cart/search UI → checkout + receipt UI
  → sale history → POS route → e2e.
- Merge to `main` via PR once verified locally and in CI.
