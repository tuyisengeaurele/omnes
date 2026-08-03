# Reports — Design

Status: Approved
Date: 2026-08-03

## Purpose

Sale/SaleItem data has existed since POS Sale Flow, but there's no way to see
it in aggregate — only the raw recent-sales list POS's own `SaleHistory`
shows. This sub-project adds a Reports section: total revenue, transaction
count, average sale value, a cash/mobile-money split, and a top-selling-
products table, over a small set of fixed date ranges (Today / This Week /
This Month / All Time). This is the "basic reports" tier already named in
`license.ts`'s `BASE_FEATURES` — charts, CSV export, and custom date ranges
are the "advanced reports" add-on tier and stay explicitly out of scope here.

No new Prisma model. This is a pure read/aggregate layer over the `Sale`/
`SaleItem` tables Authentication's `Product` and POS's `Sale`/`SaleItem`
already established.

Success criteria: an ADMIN or MANAGER can open Reports, pick a range, and see
numbers that are actually correct against the real `Sale` data for that
range (verified in tests by creating sales with controlled `createdAt`
values and checking both sides of each range boundary); a CASHIER session is
refused with a clear message, not misleading zeroed-out numbers.

## Architecture

```
electron/main/services/core/
└── reports.ts                     # getSalesSummary/getTopProducts,
                                    #   ADMIN/MANAGER-gated; resolveRange()
                                    #   is the pure date-math half
electron/main/ipc/
└── index.ts                       # + reports:get-summary,
                                    #   reports:get-top-products
shared/
└── ipc.ts                         # + ReportRange, SalesSummary, TopProduct
                                    #   types; AppApi members
src/modules/reports/
├── ReportsPage.tsx                 # range picker + summary cards +
                                     #   top-products table
└── ReportsPage.module.css
src/app/
├── AppShell.tsx                    # flip modules.reports to enabled: true
└── App.tsx                         # + <Route path="reports" ...>
```

## Components

- **`reports.ts`**: `resolveRange(range: ReportRange, now = new Date()):
{ from: Date; to: Date | null }` is pure date math, unit-testable in
  isolation by injecting `now` — mirrors `notification-rules.ts`'s existing
  pure-date-logic pattern in this codebase. `TODAY` is midnight-to-midnight
  in local time; `THIS_WEEK` starts Monday 00:00; `THIS_MONTH` starts the 1st
  at 00:00; `ALL_TIME` has `from` unbounded (`to` is always `now`, i.e. no
  future-dated sales are ever included).
  `getSalesSummary(range)` queries `Sale` where `createdAt` falls in the
  resolved range and computes `totalRevenue` (sum of `total`),
  `transactionCount`, `averageSale` (`totalRevenue / transactionCount`, `0`
  when there are no transactions — never divide by zero), `cashTotal`, and
  `mobileMoneyTotal` (summed by `paymentMethod`; `cashTotal +
mobileMoneyTotal` always equals `totalRevenue`, since `PaymentMethod` only
  has those two values today).
  `getTopProducts(range, limit = 5)` aggregates `SaleItem` joined through
  `Sale` filtered by the same range, grouping by `productName` (not
  `productId` — a line item's `productId` can be `null` if the product was
  since deleted, but `productName` is always present, the same snapshot
  field `sales.ts` already relies on for receipts), summing `quantity` and
  `quantity * unitPrice` as revenue, sorted by revenue descending, ties
  broken by quantity descending, capped at `limit`. Returns `[]` for a range
  with no sales — the UI shows an explicit empty state, not a table with no
  rows and no explanation.
  **Role gate**: both functions throw if `getSession()?.role` is not
  `'ADMIN'` or `'MANAGER'` — `'Reports are limited to managers and
administrators'`. This is a new gate shape (manager-or-above, not the
  ADMIN-only shape `users.ts`/`performRestore` use) and deliberately throws
  rather than returning zeroed/empty data the way `listUsers()` returns `[]`
  for a non-admin: an empty user list reads as "no users," which is
  harmless, but an all-zero sales summary would read as "no sales happened,"
  which is actively misleading. The renderer catches the rejection (the same
  way `LoginScreen` already catches `createFirstAdmin`/`login` throwing) and
  shows an inline "not available for your role" message instead of numbers.
- **IPC**: `reports:get-summary`, `reports:get-top-products` — thin
  passthroughs, matching every prior handler. No new `AuditAction` values;
  reading a report isn't a mutation, matching how `listProducts`/`listSales`/
  `listUsers` don't audit-log either.
- **UI**: `ReportsPage.tsx` renders four range buttons (Today / This Week /
  This Month / All Time, one always active), four summary cards (Total
  Revenue, Transactions, Average Sale, Cash vs Mobile Money as a simple
  two-number split, not a chart), and a Top Products table (name, quantity
  sold, revenue). Switching range re-fetches both endpoints. The sidebar nav
  entry itself stays visible to every role, same as every other module today
  (nothing in this app currently hides nav items by role) — the role gate is
  enforced by the service layer and surfaced inline on the page, not by
  hiding the link.

## Data flow

Mount / range change → `reports:get-summary` + `reports:get-top-products` in
parallel → cards and table render from the results, or an inline
role-rejection message renders instead if either call rejects.

## Error handling

- Non-manager/non-admin sessions get a clear thrown error from both `reports.ts`
  functions, surfaced as an inline message in `ReportsPage.tsx` — never
  zeroed cards.
- `getSalesSummary` aggregates entirely in the database (`prisma.sale.aggregate()`
  for revenue/count, a second scoped `aggregate()` for the cash subtotal) —
  no row pulled into Node. `getTopProducts` needs `quantity * unitPrice` per
  line, which Prisma's `groupBy` can't express as a summed field without raw
  SQL; it fetches `SaleItem` rows already filtered to the date range (via the
  `sale: { createdAt: ... } }` relation filter) and reduces them in Node
  instead — simpler and just as correct as raw SQL for a single shop's
  realistic sale volume, without introducing a new raw-SQL pattern into this
  file for one query.

## Testing

- `reports.test.ts` runs against the real local database: creates `Sale`/
  `SaleItem` rows directly (not through `createSale`, so `createdAt` can be
  set explicitly) at controlled timestamps — one inside today, one inside
  this week but before today, one inside this month but before this week,
  one over a month old — and checks each range boundary includes/excludes
  the right rows. Separately: a non-manager/non-admin session rejects both
  functions; `getTopProducts` sorts correctly by revenue with a controlled
  multi-product fixture; an empty range returns `[]` and a zeroed summary
  with `averageSale: 0` (no division-by-zero throw).
- e2e: after the existing POS checkout step, navigate to Reports (still the
  bootstrapped ADMIN session), confirm the summary's transaction count is at
  least 1 and the just-sold product's name appears in the top-products
  table — reusing the same run's SKU-derived product name already
  established as unique enough for that e2e file.

## Out of scope for this sub-project

Charts/visualizations, CSV or any other export, custom/arbitrary date
ranges (only the four fixed presets), per-cashier or per-product-category
breakdowns, inventory-value or low-stock reporting (that's Inventory's own
deferred scope, not Reports'), and anything requiring CRM data (customer-
level reporting waits for CRM to exist). All of these are reasonable
"advanced reports" add-on-tier candidates later, not gaps in this sub-project.

## Git workflow

- Branch: `feature/reports`, off `main`.
- Multiple small commits: shared types → `reports.ts` (`resolveRange` +
  both queries) + tests → IPC wiring → `ReportsPage` UI + locale strings →
  enable route/nav → e2e.
- Merge to `main` via PR once verified locally and in CI.
