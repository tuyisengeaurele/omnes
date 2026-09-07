# Omnes MVP Build Plan

**Status:** approved 2026-09-07. Phase 0 in progress.
**Spec:** [`docs/requirements-spec.md`](./requirements-spec.md), version 1.1.
**Scope of this build:** customer web, merchant web, admin web, API, database schema. Deferrals are listed in section 7.

---

## 0. Environment findings

Checked before planning, because two of these change what gets built.

| Finding                                                                                                                    | Impact                                                                                                                                                                                                                                  |
| -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Docker is not installed on this machine. PostgreSQL 17.4 is installed and running natively as service `postgresql-x64-17`. | `docker-compose.yml` is still written and committed as the reproducible path, but the README documents native Postgres as the verified default, since that is what has actually been run here. Confirmed with the client on 2026-09-07. |
| `github.com/tuyisengeaurele/omnes` is empty and public. Created 2026-09-07, `git ls-remote` returns zero refs.             | Public means a leaked `.env` is world-readable and indexed within minutes. The ignore rules and a pre-commit secret scan land before any other file.                                                                                    |
| The project directory is inside a OneDrive-synced folder.                                                                  | `node_modules` under OneDrive causes sync thrashing, file locks and intermittent EPERM and EBUSY errors on Windows during installs and Vite rebuilds. Not a blocker. Recommend excluding this folder from sync.                         |

An earlier note claimed this repo held a finished brick-manufacturing ERP with 101 commits and a v1.0.0 tag. The remote is empty and was recreated today, so that note was wrong and has been corrected.

---

## 1. Architecture decisions

### 1.1 API contract: Zod schemas in a shared package

`packages/contracts` exports Zod schemas. TypeScript types are inferred from them with `z.infer`. The API validates every request body, query and param with the same schema object the frontend imports.

Not tRPC, because tRPC couples the client to a Node type graph. The driver app and the B2B logistics API in FR-EXP-002 are neither TypeScript nor tRPC consumers, so choosing it now means either a second HTTP surface later or a migration.

Not OpenAPI-first, because that adds a codegen step and a second source of truth on day one.

Zod wins because server-side validation on every boundary is already a hard security requirement. Deriving the types from the validator means the contract and the validation cannot drift, since there is only one definition. When the public B2B API arrives, `zod-to-openapi` generates the document from those same schemas, so nothing is foreclosed.

### 1.2 Auth: httpOnly cookies, short access JWT, rotating refresh

Access token is a JWT with a 15 minute TTL, carried in an httpOnly, Secure, SameSite=Strict cookie. Never `localStorage`, because any XSS anywhere in the app would hand over a live session.

Refresh token is an opaque 256-bit random value with a 30 day TTL, stored in the database as a SHA-256 hash so a database read does not yield usable tokens. It rotates on every use.

Each refresh token carries a family id. Presenting a token that has already been rotated means it was stolen, so the whole family is revoked and the user is signed out everywhere. That reuse check is what makes rotation worth doing at all.

Cookie auth means CSRF applies. The defence is a double-submit token: a readable `omnes_csrf` cookie plus a matching `X-CSRF-Token` header on every non-GET request. SameSite=Strict is the first line and the token is the second, because one browser quirk should not be the only thing standing there.

Cookies are not scoped by port, so three Vite dev servers on localhost share one cookie jar and would overwrite each other's sessions. Rather than depend on `*.localhost` hostnames, which resolve inconsistently on Windows, each surface gets its own cookie name (`omnes_at_cust`, `omnes_at_mer`, `omnes_at_adm`) and its JWT carries an `aud` claim checked against the route group. A customer token replayed against `/api/admin/*` fails on audience before it reaches the role check.

Stateless-only JWT is rejected because it cannot be revoked. Ops needs to suspend a driver or a merchant immediately, not in fifteen minutes, and the stored refresh record is the kill switch.

### 1.3 Money: integer minor units

Amounts are stored as `amountMinor BigInt` with a `currency CHAR(3)` and an explicit exponent per currency. RWF has exponent 0. Floating point money is how reconciliation reports stop balancing. Multi-currency readiness for FR-PAY-006 is a property of the first migration rather than a later change.

### 1.4 Ledger: double-entry and append-only

Every money movement writes balanced debit and credit `LedgerEntry` rows under a single `LedgerTransaction`. That covers order payments, commission, refunds, payouts and wallet top-ups. There are no updates and no deletes. Corrections are reversing entries. This is what FR-PAY-003 means by immutable audit history, and it is the only version of it that survives an audit. A database constraint enforces that the entries in a transaction sum to zero.

### 1.5 Realtime order status: SSE now, WebSocket later

Order tracking only pushes server to client. SSE runs over plain HTTP, survives proxies, reconnects on its own using `Last-Event-ID`, and needs no extra infrastructure. Driver location streaming and customer to driver chat are bidirectional and will need WebSocket, so the API exposes a `RealtimePort` and SSE is one implementation behind it.

### 1.6 Geo: indexed lat and lng, PostGIS deferred

The MVP needs "drivers near this pickup" and "merchants near this address". A bounding box prefilter on a composite index over `(latitude, longitude)`, followed by exact haversine in application code, is correct and fast at Kigali scale. PostGIS is the right answer at volume but brings a heavier image and extension management for no MVP benefit. It sits behind a `GeoPort` so the swap is one adapter.

### 1.7 Monorepo tooling: npm workspaces

npm 10 already covers linking and hoisting. Turborepo earns its place once build caching matters, roughly when CI passes three minutes. Adding it now buys a dependency and a config file against a problem that does not exist yet.

### 1.8 Toolchain versions

TypeScript 6.0.3, not 7.0.2. TypeScript 7 is the current stable release, but `typescript-eslint` 8.69.0 declares `typescript >=4.8.4 <6.1.0` and no release supports 7 yet. Adopting 7 would silently disable type-aware linting, and that is where `no-floating-promises` and the `no-unsafe-*` rules live. Those are security controls in an async payment codebase, so the compiler bump is not worth losing them. Revisit when typescript-eslint ships TS 7 support.

ESLint 10, vitest 5, prettier 3.9. The versions initially resolved by caret ranges pulled ESLint 9.39.5, which is past end of support, and vitest 2.x, which carries a critical advisory. Both are pinned forward. See section 6 for the audit result.

---

## 2. Monorepo structure

```
omnes/
├── apps/
│   ├── api/                  Express, TypeScript, Prisma. One deployable, modular inside.
│   │   ├── prisma/           schema.prisma, migrations/, seed.ts
│   │   └── src/
│   │       ├── modules/          service boundaries, see section 3
│   │       │   ├── identity/     routes, service, repository, tests
│   │       │   ├── catalog/
│   │       │   ├── order/
│   │       │   ├── dispatch/
│   │       │   ├── payment/
│   │       │   ├── notification/
│   │       │   └── ops/
│   │       ├── adapters/         the external world, one folder per port
│   │       │   ├── payment/      PaymentPort, MtnMomoAdapter, AirtelAdapter, MockAdapter
│   │       │   ├── sms/          SmsPort, MockSmsAdapter
│   │       │   ├── geo/          GeoPort, HaversineAdapter
│   │       │   └── realtime/     RealtimePort, SseAdapter
│   │       ├── platform/         auth middleware, rbac, rate limiting, csrf,
│   │       │                     error handling, request logging, config loading
│   │       └── server.ts
│   ├── customer-web/         React 18, Vite, Tailwind, shadcn/ui
│   ├── merchant-web/
│   └── admin-web/
├── packages/
│   ├── contracts/            Zod schemas, inferred types, shared enums
│   ├── ui/                   shared shadcn primitives and Omnes theme
│   └── config/               shared tsconfig, tailwind preset, design tokens
├── e2e/                      Playwright, browse to cart to checkout to confirmation
├── docs/
├── scripts/
├── .github/workflows/
└── docker-compose.yml
```

`apps/*` are deployables and `packages/*` are libraries, so the split says at a glance what ships.

Modules are grouped by domain rather than by technical layer. `order/` holds its routes, service, repository and tests together because those four change together. A layer-first tree forces a three-directory edit for every change.

`adapters/` is a sibling of `modules/` rather than nested inside one, because payment and notification adapters are used by several modules. Burying `sms/` under `notification/` would invite a direct import from `order/`.

Three separate frontend apps rather than one app with role-based routing. The admin bundle should never be shippable to a customer's browser, an ops-only dependency should never sit in a customer's download, and a merchant deploy should not require retesting customer checkout. Shared pieces live in `packages/ui`.

---

## 3. Module boundaries

Each module exposes a service interface. Modules call each other only through those interfaces, never by reaching into another module's repository or Prisma models. That is what makes a later split into separate services a deployment change rather than a rewrite.

| Module         | Owns                                                                                 | Exposes                                               |
| -------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| `identity`     | users, credentials, OTP, sessions, roles, driver and merchant profiles, verification | `authenticate()`, `getActor()`, `hasRole()`           |
| `catalog`      | merchants, categories, products, modifiers, availability, opening hours              | `listMerchants()`, `getMenu()`, `assertAvailable()`   |
| `order`        | cart, pricing, order lifecycle state machine, order events, issues, ratings          | `createOrder()`, `transition()`, `getOrder()`         |
| `dispatch`     | driver availability and location, offers, assignment, decision log                   | `requestAssignment()`, `recordDecision()`             |
| `payment`      | payment intents, ledger, wallet, commission, refunds, payouts                        | `authorize()`, `capture()`, `refund()`, `postEntry()` |
| `notification` | templates, preferences, delivery records                                             | `notify(event, actor)`                                |
| `ops`          | audit log, approval queues, reconciliation views, support tickets                    | `audit()`, `listQueue()`                              |

An ESLint boundary rule fails the build on cross-module deep imports. A convention nobody can violate beats a convention in a README.

---

## 4. Database schema outline

Designed against the full spec so later verticals do not force a rewrite. Models marked MVP are built now. Every foreign key is indexed, and the indexes that carry real query load are called out.

### Identity

```
User            MVP  id, phoneE164?, email?, displayName, locale, status, createdAt
                     unique(phoneE164), unique(email), index(status)
Credential      MVP  userId, type(PHONE_OTP|EMAIL_PASSWORD|GOOGLE|APPLE), secretHash?, verifiedAt
OtpChallenge    MVP  phoneE164, codeHash, purpose, attempts, expiresAt, consumedAt
                     index(phoneE164, expiresAt) for the rate limit and lookup path
RefreshToken    MVP  userId, tokenHash, familyId, audience, expiresAt, rotatedAt, revokedAt
                     index(userId, familyId), unique(tokenHash)
Role, UserRole  MVP  CUSTOMER, DRIVER, MERCHANT_OWNER, OPS, SUPPORT, FINANCE, SUPER_ADMIN
MerchantProfile MVP  userId, merchantId, status(PENDING|APPROVED|REJECTED|SUSPENDED)
DriverProfile   MVP  userId, vehicleType, status, rating, standing
VerificationDoc MVP  ownerType, ownerId, docType, storageKey, reviewedBy, reviewedAt, decision
```

OTP codes are hashed at rest and never logged. `VerificationDoc` stores a storage key rather than the file itself, and national ID numbers are encrypted at the column level per NFR-SEC-001.

### Location and configuration

```
City            MVP  code, name, countryCode, currency, timezone, activeVerticals[]
Zone            MVP  cityId, name, polygon(JSON), deliveryRadiusM
Address         MVP  userId, label, latitude(Decimal 9,6), longitude(Decimal 9,6),
                     landmark, isDefault
                     index(userId), index(latitude, longitude)
FeeSchedule     MVP  cityId, vertical, baseFee, perKmFee, serviceFeeBps, effectiveFrom
```

Fee structure is a row rather than a constant, so enabling a city is configuration and not a deployment. That is what FR-ADM-008 asks for.

### Catalog

```
Merchant        MVP  name, vertical(FOOD|GROCERY), cityId, zoneId, latitude, longitude,
                     rating, prepTimeMinutes, isOpen, status
                     index(cityId, vertical, status), index(latitude, longitude)
MerchantHours   MVP  merchantId, dayOfWeek, opensAt, closesAt
Category        MVP  merchantId, name, sortOrder
Product         MVP  merchantId, categoryId, name, description, priceMinor, currency,
                     imageKey, isAvailable, stockCount?
                     index(merchantId, isAvailable)
ModifierGroup   MVP  productId, name, minSelect, maxSelect, required
ModifierOption  MVP  groupId, name, priceDeltaMinor
Promotion            merchantId?, code, type, valueMinor|valueBps, startsAt, endsAt,
                     maxRedemptions
```

`Product.description` is user-generated, so it is sanitized on write and rendered as text on read. Never `dangerouslySetInnerHTML`.

### Orders

```
Cart              MVP  userId, merchantId, vertical, currency, expiresAt
                       unique(userId, merchantId)
CartItem          MVP  cartId, productId, quantity, unitPriceMinor, notes
Order             MVP  orderNumber, customerId, merchantId, vertical, status, addressId,
                       subtotalMinor, deliveryFeeMinor, serviceFeeMinor, discountMinor,
                       totalMinor, currency, scheduledFor?, placedAt
                       index(customerId, placedAt), index(merchantId, status),
                       index(status, placedAt) for the ops dispatch board
OrderItem         MVP  orderId, productId, nameSnapshot, quantity, unitPriceMinor
OrderItemModifier MVP  orderItemId, nameSnapshot, priceDeltaMinor
OrderEvent        MVP  orderId, fromStatus, toStatus, actorType, actorId, reason, createdAt
                       index(orderId, createdAt), append-only lifecycle audit
OrderIssue             orderId, category, description, resolution
Rating                 orderId, subjectType(DRIVER|MERCHANT), score, comment
ParcelDetails          orderId, pickupAddressId, recipientName, recipientPhone, sizeClass
```

Order items snapshot the product name and price at order time. Rendering a six month old receipt from the current `Product.priceMinor` is a bug that surfaces as a customer dispute.

Order state machine, enforced in one place at `order/stateMachine.ts`:

```
DRAFT -> PENDING_PAYMENT -> PAID -> MERCHANT_PENDING -> ACCEPTED -> PREPARING
      -> READY_FOR_PICKUP -> ASSIGNED -> PICKED_UP -> DELIVERED
```

with `REJECTED`, `CANCELLED` and `REFUNDED` as terminal branches. Illegal transitions throw, and every transition writes an `OrderEvent`.

### Dispatch

```
DriverAvailability MVP  driverId, isOnline, vehicleType, currentZoneId, lastSeenAt
DriverLocation     MVP  driverId, latitude, longitude, accuracyM, recordedAt
                        index(driverId, recordedAt), index(latitude, longitude)
DispatchOffer      MVP  orderId, driverId, offeredAt, expiresAt,
                        outcome(ACCEPTED|DECLINED|TIMEOUT)
                        index(orderId, offeredAt)
Assignment         MVP  orderId, driverId, assignedAt, completedAt, batchId?
DispatchDecision   MVP  orderId, strategy, candidateCount, chosenDriverId, latencyMs,
                        payload(JSON)
```

`DispatchDecision` records every decision from the first day, per FR-DISP-005 and NFR-DATA-001. The training data for the real optimization engine has to exist before the engine does.

### Payments

```
PaymentIntent  MVP  orderId, method(MTN_MOMO|AIRTEL|CARD|CASH|WALLET), amountMinor,
                    currency, status, providerRef, idempotencyKey
                    unique(idempotencyKey)
PaymentAttempt MVP  intentId, attemptNo, status, providerCode, providerMessage,
                    rawResponse(JSON)
LedgerAccount  MVP  ownerType(PLATFORM|MERCHANT|DRIVER|CUSTOMER), ownerId, kind, currency
LedgerTxn      MVP  reference, kind, occurredAt, memo, append-only
LedgerEntry    MVP  txnId, accountId, direction(DEBIT|CREDIT), amountMinor, currency
                    index(accountId, txnId) for balance queries
Wallet              userId, currency. Balance is derived from the ledger.
CommissionRule MVP  scope, merchantId?, vertical?, rateBps, effectiveFrom
Payout              payeeType, payeeId, periodStart, periodEnd, grossMinor,
                    commissionMinor, netMinor, status, providerRef
Refund              orderId, amountMinor, destination(ORIGINAL|WALLET), approvedBy
PromoRedemption     promotionId, userId, orderId, unique(promotionId, userId)
```

Wallet balance is derived from the ledger rather than stored in a mutable column. A stored balance and a ledger will disagree eventually, and then someone has to decide which one is lying.

### Notifications and ops

```
NotificationPref MVP  userId, category, channels[]
NotificationLog  MVP  userId, category, channel, providerRef, status, sentAt.
                      Message bodies are never logged.
AuditLog         MVP  actorId, actorRole, action, entityType, entityId, before(JSON),
                      after(JSON), ip
                      index(entityType, entityId), index(actorId, createdAt)
SupportTicket         orderId?, userId, category, priority, status, slaDueAt
FraudFlag             subjectType, subjectId, signal, severity, reviewedBy
```

---

## 5. Build order

Backend contracts before frontends, and one vertical slice end to end before breadth. Each phase is a branch merged with `--no-ff`. Each bullet is roughly one commit.

**Phase 0, repo tooling and CI.** Branch `chore/repo-scaffolding`.

- Ignore rules and a pre-commit secret scan, as the first commits
- Commit message and prose style checks in hooks and CI
- npm workspaces root
- Shared tsconfig, ESLint and Prettier configuration
- Tailwind preset and design tokens using aureolin #FBE311 and bistre #261606
- `docker-compose.yml` plus the verified native Postgres path
- GitHub Actions running lint, typecheck, test, secret scan and audit
- Dependency audit triaged and resolved
- README covering setup from a fresh clone

**Phase 1, schema and contracts.** Branch `feat/data-model`.

- Prisma schema for the MVP models
- Initial migration
- Seed data: Kigali city and zones, six merchants, around sixty products, staff users
- `packages/contracts` base schemas
- Module boundary lint rule

**Phase 2, identity and auth.** Branch `feat/identity-auth`.

- Config loader with fail-fast environment validation
- OTP service: hashed, short-lived, rate limited per phone, never logged
- Register, verify, refresh and logout endpoints
- Cookie, CSRF and audience middleware
- RBAC guard and rate limiters
- CORS allowlist
- Tests covering expired OTP, replayed OTP, refresh reuse detection, cross-audience token replay and brute force lockout

**Phase 3, catalog.** Branch `feat/catalog-api`.

- Paginated merchant list filtered by vertical, distance, rating and ETA
- Search with autocomplete
- Menu fetch with deliberate `include` to avoid N+1
- Availability rules
- Merchant CRUD behind RBAC

**Phase 4, cart and pricing.** Branch `feat/cart-pricing`.

- Cart operations that revalidate price and availability server-side on every mutation
- Pricing engine as a pure function with heavy unit test coverage
- Out-of-stock and stale-price edge cases

**Phase 5, checkout, payment port and ledger.** Branch `feat/checkout-payments`.

- `PaymentPort` and a mock MoMo adapter that models real behaviour: async pending state, webhook callback, timeout, insufficient funds, duplicate webhook idempotency
- Double-entry ledger posting with the sum-to-zero constraint
- Commission calculation with unit tests
- Order creation inside a transaction
- Idempotent checkout that is safe against double submit

**Phase 6, order lifecycle and tracking.** Branch `feat/order-lifecycle`.

- State machine with illegal transition tests
- `OrderEvent` emission
- SSE stream behind `RealtimePort`
- Paginated order history
- `NotificationPort` with a logging adapter

**Phase 7, dispatch.** Branch `feat/dispatch-engine`.

- `DispatchStrategy` interface and a nearest-available implementation
- Offer, accept, decline and timeout loop
- Radius escalation and ops fallback per FR-DISP-004
- Decision logging
- Driverless zone test

**Phase 8, customer web.** Branch `feat/customer-web`. This is the vertical slice.

- Typed API client built from the contracts package
- Auth flow
- Browse and search
- Merchant and menu views
- Cart
- Address management with map pin-drop behind a `MapPort`, using Leaflet and OpenStreetMap
- Checkout
- Live order tracking over SSE
- Order history

This loop has to work end to end before phase 9 starts.

**Phase 9, merchant web.** Branch `feat/merchant-web`.

- Catalog management
- Order queue with accept, reject and prep time input
- Availability toggles
- Sales view

**Phase 10, admin web.** Branch `feat/admin-web`.

- Order and dispatch overview
- Approval queue for merchants and drivers
- Reconciliation view reading the ledger
- Audit trail on every ops action

**Phase 11, end to end tests and hardening.** Branch `feat/e2e-and-hardening`.

- Playwright covering browse, cart, checkout and confirmation
- Documented walkthrough of the security checklist
- Dependency audit cleanup and Dependabot configuration
- Load-bearing indexes verified with EXPLAIN

---

## 6. Security checklist

Walked before any module is called done.

**Auth and session.** OTP hashed, short-lived, rate limited, never logged. Tokens only in httpOnly cookies. Refresh rotation with reuse detection. CSRF double-submit on every non-GET. Audience-scoped tokens. RBAC enforced server-side on every merchant, admin and ops route, because a hidden button in the frontend is not a security boundary. Rate limits on auth, OTP, search and checkout. An explicit CORS allowlist with no wildcard, including in local development.

**Data.** Zod validation on every body, query and param. No raw SQL string concatenation anywhere, enforced by a lint rule against `$queryRawUnsafe` and `$executeRawUnsafe`. User-generated content sanitized on write and escaped on render. National ID and payment identifiers encrypted at rest. Structured logs with a redaction allowlist so OTPs, tokens, card numbers and national ID numbers are never emitted at any level.

**Repository.** Ignore rules covering `.env*`, dependencies, build output and OS files, committed first. Pre-commit secret scan. No credential in any commit, given the remote is public.

**Dependencies.** The initial install resolved five advisories, all from a single root cause: `esbuild` reached through `vite` and `vitest` 2.x. That chain included a critical arbitrary file read and execute in the Vitest UI server, a Vite path traversal, and an NTLMv2 hash disclosure through UNC path handling on Windows, which matters directly because development happens on Windows. Resolved by moving to vitest 5 and ESLint 10 rather than by suppression. CI runs `npm audit --audit-level=high` on every push.

---

## 7. Judgment calls and deferrals

1. Native Postgres is the verified setup path. `docker-compose.yml` is committed but has not been run on this machine. Confirmed with the client.
2. Zod-derived contracts rather than tRPC or OpenAPI-first. See section 1.1.
3. Distinct cookie names plus a JWT audience claim to separate the three surfaces in development, rather than custom hostnames. See section 1.2.
4. Wallet balance derived from the ledger rather than stored. Correct but slightly slower. A materialized balance with a reconciliation job is the answer at scale.
5. PostGIS deferred in favour of indexed lat and lng with haversine behind a `GeoPort`. See section 1.6.
6. TypeScript 6 rather than 7, to keep type-aware linting. See section 1.8.
7. Leaflet and OpenStreetMap for pin-drop, so nothing needs a paid API key to run. Mapbox or Google Maps slot in behind the same `MapPort`.
8. Turborepo deferred. See section 1.7.
9. Deferred from this MVP, though the schema is shaped to accept them: driver app, live GPS tracking, in-app chat, AI cart builder, group ordering, scheduled order UI, subscriptions, USSD status check, loyalty, referrals, parcel vertical UI, merchant ads, and the Kinyarwanda and French translation strings. The i18n resource layer goes in; the translations do not.
10. Payment stubs model failure rather than success. The mock adapter returns pending states, timeouts, insufficient funds and duplicate webhooks, so the real integration is a configuration swap rather than a rewrite of code that assumed everything always works.
