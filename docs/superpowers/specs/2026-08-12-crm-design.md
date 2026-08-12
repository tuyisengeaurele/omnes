# CRM — Design

Status: Approved
Date: 2026-08-12

## Purpose

There is no customer record in OMNES today — every `Sale` is anonymous
beyond its cashier. This sub-project adds a customer directory (add/edit,
search, soft-deactivate — matching `Product`/`User`'s existing patterns) and
lets a sale optionally be attributed to a customer at checkout, so a shop can
look up who bought what. This is the master brief's last remaining business
module; everything else (Core, POS, Inventory, Reports, Administration) is
already built.

Loyalty points and store credit are explicitly **not** part of this
sub-project — `shared/ipc.ts`'s `Feature` type already reserves `'loyalty'`
and `'store_credit'` as separate add-on tiers distinct from base `'crm'`,
and nothing in this sub-project should assume or half-build either.

Success criteria: a user can add a customer with just a name (phone/email/
notes optional); search and find them; edit or deactivate them; at POS
checkout, optionally search for and attach a customer to the sale, or leave
it blank for a walk-in sale; a customer's page shows their past purchases;
deactivating or (hypothetically) losing a customer record never breaks or
rewrites a past sale's history, matching the snapshot-on-write principle
`cashierUsername`/`SaleItem.productName` already established.

## Architecture

```
prisma/schema.prisma              # + Customer model; Sale + customerId/
                                   #   customerName (nullable, SetNull)
electron/main/services/core/
├── customers.ts                    # list/create/update/setActive, no
                                     #   role gate (matches POS/Inventory)
└── sales.ts                        # createSale resolves customerId inside
                                     #   its existing transaction (same
                                     #   pattern as cashierId); listSales
                                     #   gains an optional customerId filter
electron/main/ipc/
└── index.ts                        # + customer:list/create/update/
                                     #   set-active; sale:list gains an
                                     #   optional customerId argument
shared/
└── ipc.ts                          # + Customer, CustomerInput,
                                     #   CustomerResult types; Sale +
                                     #   CreateSaleInput gain customerId/
                                     #   customerName
src/modules/crm/
├── CustomersPage.tsx                 # list/search + toggle to CustomerForm
├── CustomerForm.tsx                  # shared add/edit form (name/phone/
                                       #   email/notes), matches ProductForm
└── CustomerDetail.tsx                # a customer's info + purchase history
src/modules/pos/
├── CustomerPicker.tsx                 # search-and-select, matches
                                        #   ProductSearch's in-memory-filter
                                        #   pattern; "walk-in" clears selection
└── CheckoutPanel.tsx                  # modified: renders CustomerPicker,
                                        #   passes customerId to createSale
```

## Components

- **`Customer` model**: `id, name, phone?, email?, notes?, isActive
(default true), createdAt, updatedAt`. No uniqueness constraint on phone or
  email — a small shop's real customer data has blanks and occasional
  duplicates, and inventing a uniqueness rule nobody asked for is exactly
  the kind of unjustified complexity `Product.category` avoided by staying a
  plain string. `Sale` gains `customerId String?` (FK, `onDelete: SetNull`,
  same relation shape as `Sale.cashierId`) and `customerName String?` (a
  snapshot at sale time, same shape as `cashierUsername`) — so a later
  customer rename or deactivation never rewrites a historical receipt.
- **`customers.ts`**: `listCustomers(includeInactive?)`,
  `createCustomer(input)`, `updateCustomer(id, input)`,
  `setCustomerActive(id, isActive)` — all return a `CustomerResult`
  (`{ success, message, customer }`), matching `products.ts`'s convention.
  `name` must be non-empty (trimmed, minimum 2 characters, mirroring
  `MIN_USERNAME_LENGTH`'s spirit); `phone`/`email`/`notes` are free text with
  no format validation — inventing phone/email format rules nobody asked
  for is out of scope, same reasoning as the no-uniqueness decision above.
  **No role gate** — every function is reachable by any authenticated
  session, matching POS/Inventory's current accepted-gap model (a cashier
  legitimately needs to add a new customer mid-checkout), unlike Reports'
  ADMIN/MANAGER restriction.
- **`sales.ts` changes** (the one piece of already-shipped main-process code
  this sub-project modifies, beyond `CheckoutPanel.tsx`): `createSale`'s
  existing `Serializable` transaction gains one more defensive lookup,
  exactly mirroring how `cashierId` is already resolved inside that same
  transaction — if `input.customerId` is provided, the transaction looks up
  the `Customer` row itself (never trusts a name string from the renderer)
  and snapshots its `name`; if the row doesn't exist (deleted, or a stale
  reference from a restore — the same scenario `cashierId`'s handling was
  built for), the sale still completes with `customerId: null` rather than
  failing, keeping only the graceful-degrade behavior already established.
  `listSales` gains an optional `customerId` parameter (`where: customerId ?
{ customerId } : undefined`) — backward compatible, existing POS call
  sites are unaffected since it's optional.
- **`CustomerPicker.tsx`**: fetches `listCustomers()` once, filters
  in-memory by name/phone as the user types — identical shape to
  `ProductSearch.tsx`, appropriate at the same "a shop's customer list
  comfortably fits in memory" scale that component already assumes. A
  visible "no customer / walk-in" option clears the selection back to
  `null`. Lives inside `CheckoutPanel.tsx`, above the payment method
  toggle; `handleCheckout` passes the selected `customerId` (or `null`) to
  `createSale`.
- **`CustomersPage.tsx`/`CustomerForm.tsx`**: table + shared add/edit form,
  matching `ProductsPage`/`ProductForm`'s existing pattern exactly (not
  `UsersPanel`'s per-row-action pattern, since editing a customer's own
  fields is one general-purpose edit, not several independent narrow
  actions the way role/active-status/password are for a `User`).
- **`CustomerDetail.tsx`**: a customer's contact info plus their purchase
  history (`listSales(customerId)`), rendered as a simple read-only table
  (date, total, payment method) — not the full `SaleHistory`/`ReceiptView`
  machinery, which is POS-specific and more than a purchase-history glance
  needs.

## Data flow

CRM: `CustomersPage` → `customer:list` → table; add/edit → `CustomerForm` →
`customer:create`/`customer:update` → refetch; deactivate/reactivate →
`customer:set-active` → refetch; clicking a customer → `CustomerDetail` →
`sale:list` (filtered) for their history.

POS: `CheckoutPanel` mounts `CustomerPicker` → `customer:list` once →
in-memory filter as the cashier types → selecting one sets local state →
`handleCheckout` includes `customerId` in the `sale:create` call → the
completed `Sale`'s `customerName` (if any) is available to `ReceiptView`
already, since `Sale` already crosses IPC as one object.

## Error handling

- `customers.ts` returns the same `{ success, message, customer }` shape on
  every failure (empty/too-short name) — never a raw Prisma error.
- `createSale`'s customer resolution never fails the sale — a missing/
  invalid `customerId` degrades to an unattributed (walk-in-equivalent)
  sale, the same philosophy `cashierId`'s handling already established, not
  a new error path.

## Testing

- `customers.test.ts`: CRUD round-trip; empty/short name rejected;
  `listCustomers(false)` excludes deactivated customers by default,
  `listCustomers(true)` includes them (mirroring `listProducts`'s existing
  `includeInactive` parameter).
- `sales.test.ts` additions: a sale created with a real `customerId`
  correctly snapshots `customerName` and `listSales(customerId)` returns
  it; a sale created with a `customerId` that doesn't exist (deleted
  between selection and submission) still succeeds with `customerId: null`,
  mirroring the existing stale-cashier test's structure exactly.
- e2e: from the bootstrapped session, add a customer via CRM, then in POS
  select that customer during the existing checkout flow and complete the
  sale, then confirm the customer's detail page shows that purchase in
  their history — proving the full add → attach → verify loop, not just
  that each piece renders in isolation.

## Out of scope for this sub-project

Loyalty points, store credit, and any balance/ledger concept (separate,
already-reserved add-on tiers — see Purpose). Customer segmentation, tags,
or marketing/messaging features. CSV import/export of customers.
Duplicate-customer detection or merge tooling. Phone/email format
validation. Role-gating CRM (an explicit, deliberate decision, not an
oversight — see Components above).

## Git workflow

- Branch: `feature/crm`, off `main`.
- Multiple small commits: `Customer` model + migration → shared types →
  `customers.ts` + tests → `sales.ts` customer-attribution changes + tests
  → IPC wiring → CRM locale strings → `CustomerForm`/`CustomersPage` →
  `CustomerDetail` → `CustomerPicker` wired into `CheckoutPanel` → enable
  the `/crm` route → e2e.
- Merge to `main` via PR once verified locally and in CI.
