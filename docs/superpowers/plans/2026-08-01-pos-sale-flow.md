# POS Sale Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A cashier can search the catalog, build a cart, check out with cash or mobile money, and get a receipt — with stock deducted atomically and no way for two concurrent checkouts to oversell the same product.

**Architecture:** `sales.ts` runs the entire checkout inside one `Serializable`-isolation Prisma transaction — re-reading stock, rejecting on insufficiency, decrementing, and creating the `Sale`/`SaleItem` rows all atomically — the same class of fix `createFirstAdmin` already established for its own TOCTOU race. `Sale`/`SaleItem` snapshot the cashier's username and each line's product name/price at time of sale (mirroring `AuditLog.username` and `BackupRecord`'s general "snapshot what must survive later changes" pattern), so a later product rename, re-price, or user deletion never rewrites history. Cart-building itself is pure renderer state — nothing is persisted until checkout succeeds.

**Tech Stack:** No new npm dependencies — Prisma, the existing IPC/service-layer conventions, and the OS print dialog via `window.print()`.

---

### Task 1: Sale and SaleItem models

**Files:**

- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add the PaymentMethod enum, Sale and SaleItem models, and back-relations**

Add after the `Product` model:

```prisma
enum PaymentMethod {
  CASH
  MOBILE_MONEY
}

model Sale {
  id              String        @id @default(uuid())
  cashierId       String?
  cashierUsername String?
  paymentMethod   PaymentMethod
  amountTendered  Int?
  changeGiven     Int?
  total           Int
  createdAt       DateTime      @default(now())

  cashier User?      @relation(fields: [cashierId], references: [id], onDelete: SetNull)
  items   SaleItem[]
}

model SaleItem {
  id          String @id @default(uuid())
  saleId      String
  productId   String?
  productName String
  unitPrice   Int
  quantity    Int

  sale    Sale     @relation(fields: [saleId], references: [id], onDelete: Cascade)
  product Product? @relation(fields: [productId], references: [id], onDelete: SetNull)
}
```

Add `sales Sale[]` to the `User` model (alongside the existing `auditLogs AuditLog[]`), and `saleItems SaleItem[]` to the `Product` model — Prisma requires the reverse side of every relation to be declared.

`amountTendered`/`changeGiven` stay nullable because they're cash-only —
a mobile money sale records no tendered/change concept. `SaleItem.saleId`
cascades on delete (line items have no meaning without their sale);
`SaleItem.productId` and `Sale.cashierId` both `SetNull` (a sale must
survive a product being deactivated or a user account being removed,
which is exactly why `productName`/`unitPrice`/`cashierUsername` are
snapshotted as plain columns, not derived through the relation).

- [ ] **Step 2: Generate and apply the migration**

Run: `pnpm exec prisma migrate dev --name add_sales`
Expected: a new folder under `prisma/migrations/` and the local `omnes_dev`
database now has `Sale` and `SaleItem` tables.

- [ ] **Step 3: Verify typecheck**

Run: `pnpm typecheck`
Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git checkout main
git pull
git checkout -b feature/pos-sale-flow
git add prisma/schema.prisma prisma/migrations
git commit -m "Add the Sale and SaleItem models"
```

---

### Task 2: Shared sale types

**Files:**

- Modify: `shared/ipc.ts`

- [ ] **Step 1: Add sale channels, types, and AppApi members to shared/ipc.ts**

Add to `IPC_CHANNELS`:

```typescript
  createSale: 'sale:create',
  listSales: 'sale:list',
  getSale: 'sale:get',
```

Add after the `Product`/`ProductInput`/`ProductResult` interfaces:

```typescript
export type PaymentMethod = 'CASH' | 'MOBILE_MONEY';

export interface SaleItem {
  id: string;
  productId: string | null;
  productName: string;
  unitPrice: number;
  quantity: number;
}

export interface Sale {
  id: string;
  cashierUsername: string | null;
  paymentMethod: PaymentMethod;
  amountTendered: number | null;
  changeGiven: number | null;
  total: number;
  createdAt: string;
  items: SaleItem[];
}

export interface SaleLineInput {
  productId: string;
  quantity: number;
}

export interface CreateSaleInput {
  items: SaleLineInput[];
  paymentMethod: PaymentMethod;
  amountTendered: number | null;
}

export interface SaleResult {
  success: boolean;
  message: string;
  sale: Sale | null;
}
```

Add to `AppApi`:

```typescript
createSale: (input: CreateSaleInput) => Promise<SaleResult>;
listSales: () => Promise<Sale[]>;
getSale: (id: string) => Promise<Sale | null>;
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm typecheck`
Expected: fails — `electron/preload/index.ts` doesn't implement the new
`AppApi` members yet, fixed in Task 4.

- [ ] **Step 3: Commit**

```bash
git add shared/ipc.ts
git commit -m "Add sale types to the shared IPC contract"
```

---

### Task 3: Sale service with a transactional checkout, and tests

**Files:**

- Create: `tests/unit/sales.test.ts`
- Create: `electron/main/services/core/sales.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { createProduct, listProducts } from '../../electron/main/services/core/products';
import { createSale, getSale, listSales } from '../../electron/main/services/core/sales';
import { prisma } from '../../electron/main/services/core/database';

function uniqueSku(): string {
  return `TEST-${randomUUID()}`;
}

describe('sales', () => {
  const createdSaleIds: string[] = [];
  const createdProductIds: string[] = [];

  afterAll(async () => {
    await prisma.sale.deleteMany({ where: { id: { in: createdSaleIds } } });
    await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
    await prisma.$disconnect();
  });

  async function makeTestProduct(stockQuantity: number, price = 100): Promise<string> {
    const result = await createProduct({
      name: 'Test Sale Product',
      sku: uniqueSku(),
      barcode: null,
      category: 'Widgets',
      price,
      stockQuantity,
    });
    const id = result.product?.id as string;
    createdProductIds.push(id);
    return id;
  }

  it('completes a cash sale and deducts stock', async () => {
    const productId = await makeTestProduct(10, 500);

    const result = await createSale({
      items: [{ productId, quantity: 3 }],
      paymentMethod: 'CASH',
      amountTendered: 2000,
    });

    expect(result.success).toBe(true);
    expect(result.sale?.total).toBe(1500);
    expect(result.sale?.changeGiven).toBe(500);
    if (result.sale) createdSaleIds.push(result.sale.id);

    const products = await listProducts(true);
    expect(products.find((product) => product.id === productId)?.stockQuantity).toBe(7);
  });

  it('rejects a sale when stock is insufficient, leaving stock unchanged', async () => {
    const productId = await makeTestProduct(2);

    const result = await createSale({
      items: [{ productId, quantity: 5 }],
      paymentMethod: 'CASH',
      amountTendered: 1000,
    });

    expect(result.success).toBe(false);
    expect(result.sale).toBeNull();

    const products = await listProducts(true);
    expect(products.find((product) => product.id === productId)?.stockQuantity).toBe(2);
  });

  it('rejects a cash sale with insufficient amount tendered', async () => {
    const productId = await makeTestProduct(10, 1000);

    const result = await createSale({
      items: [{ productId, quantity: 1 }],
      paymentMethod: 'CASH',
      amountTendered: 500,
    });

    expect(result.success).toBe(false);
    expect(result.message).toBe('Amount tendered is less than the total');
  });

  it('records a mobile money sale without amount tendered or change', async () => {
    const productId = await makeTestProduct(5, 1000);

    const result = await createSale({
      items: [{ productId, quantity: 1 }],
      paymentMethod: 'MOBILE_MONEY',
      amountTendered: null,
    });

    expect(result.success).toBe(true);
    expect(result.sale?.amountTendered).toBeNull();
    expect(result.sale?.changeGiven).toBeNull();
    if (result.sale) createdSaleIds.push(result.sale.id);
  });

  it('does not oversell when two checkouts race for the last unit', async () => {
    const productId = await makeTestProduct(1, 100);

    const [first, second] = await Promise.all([
      createSale({
        items: [{ productId, quantity: 1 }],
        paymentMethod: 'CASH',
        amountTendered: 100,
      }),
      createSale({
        items: [{ productId, quantity: 1 }],
        paymentMethod: 'CASH',
        amountTendered: 100,
      }),
    ]);

    const successes = [first, second].filter((result) => result.success);
    expect(successes).toHaveLength(1);
    for (const result of successes) {
      if (result.sale) createdSaleIds.push(result.sale.id);
    }

    const products = await listProducts(true);
    expect(products.find((product) => product.id === productId)?.stockQuantity).toBe(0);
  }, 15_000);

  it('lists and retrieves a sale', async () => {
    const productId = await makeTestProduct(5, 250);
    const created = await createSale({
      items: [{ productId, quantity: 2 }],
      paymentMethod: 'CASH',
      amountTendered: 1000,
    });
    const saleId = created.sale?.id as string;
    createdSaleIds.push(saleId);

    const sales = await listSales();
    expect(sales.some((sale) => sale.id === saleId)).toBe(true);

    const fetched = await getSale(saleId);
    expect(fetched?.items).toHaveLength(1);
    expect(fetched?.items[0]?.productName).toBe('Test Sale Product');
  });
});
```

The race test is the property this whole transactional design exists to
guarantee — matching `auth.test.ts`'s `createFirstAdmin` concurrency test,
it needs to be proven against the real database, not assumed from reading
the code.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test`
Expected: FAIL — `Cannot find module '../../electron/main/services/core/sales'`.

- [ ] **Step 3: Write electron/main/services/core/sales.ts**

```typescript
import { Prisma } from '../../../../generated/prisma/client';
import { getSession } from './auth';
import { prisma } from './database';
import type { CreateSaleInput, Sale, SaleResult } from '@shared/ipc';

interface SaleRow {
  id: string;
  cashierUsername: string | null;
  paymentMethod: string;
  amountTendered: number | null;
  changeGiven: number | null;
  total: number;
  createdAt: Date;
  items: {
    id: string;
    productId: string | null;
    productName: string;
    unitPrice: number;
    quantity: number;
  }[];
}

function toSale(row: SaleRow): Sale {
  return {
    id: row.id,
    cashierUsername: row.cashierUsername,
    paymentMethod: row.paymentMethod as Sale['paymentMethod'],
    amountTendered: row.amountTendered,
    changeGiven: row.changeGiven,
    total: row.total,
    createdAt: row.createdAt.toISOString(),
    items: row.items.map((item) => ({
      id: item.id,
      productId: item.productId,
      productName: item.productName,
      unitPrice: item.unitPrice,
      quantity: item.quantity,
    })),
  };
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
    return 'Checkout conflicted with another sale in progress. Please try again.';
  }
  return error instanceof Error ? error.message : String(error);
}

export async function createSale(input: CreateSaleInput): Promise<SaleResult> {
  if (input.items.length === 0) {
    return { success: false, message: 'Cart is empty', sale: null };
  }

  try {
    const session = getSession();

    const row = await prisma.$transaction(
      async (tx) => {
        let total = 0;
        const lineData: {
          productId: string;
          productName: string;
          unitPrice: number;
          quantity: number;
        }[] = [];

        for (const line of input.items) {
          if (line.quantity <= 0) {
            throw new Error('Quantity must be at least 1');
          }
          const product = await tx.product.findUnique({ where: { id: line.productId } });
          if (!product) {
            throw new Error('A product in the cart no longer exists');
          }
          if (product.stockQuantity < line.quantity) {
            throw new Error(`${product.name} is out of stock`);
          }
          total += product.price * line.quantity;
          lineData.push({
            productId: product.id,
            productName: product.name,
            unitPrice: product.price,
            quantity: line.quantity,
          });
          await tx.product.update({
            where: { id: product.id },
            data: { stockQuantity: { decrement: line.quantity } },
          });
        }

        let changeGiven: number | null = null;
        if (input.paymentMethod === 'CASH') {
          if (input.amountTendered === null || input.amountTendered < total) {
            throw new Error('Amount tendered is less than the total');
          }
          changeGiven = input.amountTendered - total;
        }

        return tx.sale.create({
          data: {
            cashierId: session?.userId ?? null,
            cashierUsername: session?.username ?? null,
            paymentMethod: input.paymentMethod,
            amountTendered: input.paymentMethod === 'CASH' ? input.amountTendered : null,
            changeGiven,
            total,
            items: { create: lineData },
          },
          include: { items: true },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    return { success: true, message: 'Sale completed', sale: toSale(row) };
  } catch (error) {
    return { success: false, message: toErrorMessage(error), sale: null };
  }
}

export async function listSales(): Promise<Sale[]> {
  const rows = await prisma.sale.findMany({
    include: { items: true },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map(toSale);
}

export async function getSale(id: string): Promise<Sale | null> {
  const row = await prisma.sale.findUnique({ where: { id }, include: { items: true } });
  return row ? toSale(row) : null;
}
```

`Serializable` isolation is what makes the race test above actually pass —
under Postgres's default `READ COMMITTED`, the check-then-decrement across
two statements inside the transaction isn't atomic together (only each
individual statement is), so two concurrent checkouts could both read
sufficient stock before either commits. `Serializable` makes Postgres
detect that conflict and abort one transaction with a `P2034` error
instead, which `toErrorMessage` turns into a clear retry message — the
same pattern `createFirstAdmin` already established in `auth.ts` for its
own TOCTOU race, applied here to inventory instead of user creation.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test`
Expected: PASS — all six new tests plus every pre-existing test.

- [ ] **Step 5: Verify typecheck**

Run: `pnpm typecheck`
Expected: same pre-existing `AppApi` failure as Task 2, nothing new.

- [ ] **Step 6: Commit**

```bash
git add tests/unit/sales.test.ts electron/main/services/core/sales.ts
git commit -m "Add the sale service with a transactional checkout"
```

---

### Task 4: Wire the sale IPC channels

**Files:**

- Modify: `electron/preload/index.ts`
- Modify: `electron/main/ipc/index.ts`

- [ ] **Step 1: Add the sale methods to electron/preload/index.ts**

Add to the `api` object:

```typescript
  createSale: (input) => ipcRenderer.invoke(IPC_CHANNELS.createSale, input),
  listSales: () => ipcRenderer.invoke(IPC_CHANNELS.listSales),
  getSale: (id) => ipcRenderer.invoke(IPC_CHANNELS.getSale, id),
```

- [ ] **Step 2: Add the handlers to electron/main/ipc/index.ts**

Add the import:

```typescript
import { createSale, getSale, listSales } from '../services/core/sales';
```

Add `CreateSaleInput`, `Sale`, and `SaleResult` to the existing `@shared/ipc` type import.

Add inside `registerIpcHandlers()`:

```typescript
ipcMain.handle(IPC_CHANNELS.createSale, (_event, input: CreateSaleInput): Promise<SaleResult> =>
  createSale(input),
);

ipcMain.handle(IPC_CHANNELS.listSales, (): Promise<Sale[]> => listSales());

ipcMain.handle(IPC_CHANNELS.getSale, (_event, id: string): Promise<Sale | null> => getSale(id));
```

- [ ] **Step 3: Verify typecheck**

Run: `pnpm typecheck`
Expected: zero errors.

- [ ] **Step 4: Verify lint and tests**

Run: `pnpm lint && pnpm test`
Expected: zero errors, all tests passing.

- [ ] **Step 5: Commit**

```bash
git add electron/preload/index.ts electron/main/ipc/index.ts
git commit -m "Wire sale IPC channels"
```

---

### Task 5: POS locale strings

**Files:**

- Modify: `src/locales/en.json`, `src/locales/rw.json`, `src/locales/fr.json`

- [ ] _*Step 1: Add pos.* keys to all three locale files_*

Add to `src/locales/en.json` (after the `inventory.*` keys, before `modules.*`):

```json
  "pos.searchPlaceholder": "Search products by name, SKU, or barcode",
  "pos.stock": "Stock",
  "pos.cart": "Cart",
  "pos.emptyCart": "Cart is empty.",
  "pos.remove": "Remove",
  "pos.total": "Total",
  "pos.cash": "Cash",
  "pos.mobileMoney": "Mobile Money",
  "pos.amountTendered": "Amount tendered",
  "pos.change": "Change",
  "pos.checkout": "Checkout",
  "pos.processing": "Processing...",
  "pos.checkoutError": "Could not complete the sale.",
  "pos.print": "Print",
  "pos.close": "Close",
  "pos.cashier": "Cashier",
  "pos.recentSales": "Recent sales",
```

Add to `src/locales/rw.json`:

```json
  "pos.searchPlaceholder": "Shakisha ibicuruzwa hakoreshejwe izina, SKU, cyangwa kode",
  "pos.stock": "Ububiko",
  "pos.cart": "Igikapu",
  "pos.emptyCart": "Igikapu kirimo ubusa.",
  "pos.remove": "Kuraho",
  "pos.total": "Igiteranyo",
  "pos.cash": "Amafaranga",
  "pos.mobileMoney": "Mobile Money",
  "pos.amountTendered": "Amafaranga yatanzwe",
  "pos.change": "Ikigereranyo",
  "pos.checkout": "Ishura",
  "pos.processing": "Turimo gutunganya...",
  "pos.checkoutError": "Kugurisha ntibyakunze.",
  "pos.print": "Sohora",
  "pos.close": "Funga",
  "pos.cashier": "Umucuruzi",
  "pos.recentSales": "Ibyaguzwe vuba",
```

Add to `src/locales/fr.json`:

```json
  "pos.searchPlaceholder": "Rechercher un produit par nom, SKU ou code-barres",
  "pos.stock": "Stock",
  "pos.cart": "Panier",
  "pos.emptyCart": "Le panier est vide.",
  "pos.remove": "Retirer",
  "pos.total": "Total",
  "pos.cash": "Espèces",
  "pos.mobileMoney": "Mobile Money",
  "pos.amountTendered": "Montant reçu",
  "pos.change": "Monnaie rendue",
  "pos.checkout": "Payer",
  "pos.processing": "Traitement...",
  "pos.checkoutError": "Impossible de finaliser la vente.",
  "pos.print": "Imprimer",
  "pos.close": "Fermer",
  "pos.cashier": "Caissier",
  "pos.recentSales": "Ventes récentes",
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm typecheck`
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/locales
git commit -m "Add POS locale strings"
```

---

### Task 6: Product search and cart components

**Files:**

- Create: `src/modules/pos/ProductSearch.module.css`
- Create: `src/modules/pos/ProductSearch.tsx`
- Create: `src/modules/pos/Cart.module.css`
- Create: `src/modules/pos/Cart.tsx`

- [ ] **Step 1: Write src/modules/pos/ProductSearch.module.css**

```css
.search {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.input {
  padding: var(--space-3);
  background-color: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  color: var(--color-text-primary);
  font-size: 1rem;
}

.results {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  max-height: 360px;
  overflow-y: auto;
}

.resultItem {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--space-2) var(--space-3);
  background-color: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  color: var(--color-text-primary);
  text-align: left;
  cursor: pointer;
}

.resultItem:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.resultName {
  font-size: 0.875rem;
  font-weight: 600;
}

.resultMeta {
  font-size: 0.75rem;
  color: var(--color-text-secondary);
}
```

- [ ] **Step 2: Write src/modules/pos/ProductSearch.tsx**

```typescript
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Product } from '@shared/ipc';
import styles from './ProductSearch.module.css';

interface ProductSearchProps {
  onSelect: (product: Product) => void;
}

export function ProductSearch({ onSelect }: ProductSearchProps) {
  const { t } = useTranslation();
  const [products, setProducts] = useState<Product[]>([]);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    window.omnes
      ?.listProducts()
      .then((list) => {
        if (!cancelled) setProducts(list);
      })
      .catch((error: unknown) => {
        console.error('Failed to list products', error);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const normalizedQuery = query.trim().toLowerCase();
  const results = normalizedQuery
    ? products.filter(
        (product) =>
          product.name.toLowerCase().includes(normalizedQuery) ||
          product.sku.toLowerCase().includes(normalizedQuery) ||
          (product.barcode?.toLowerCase().includes(normalizedQuery) ?? false),
      )
    : products;

  return (
    <div className={styles.search}>
      <input
        type="text"
        className={styles.input}
        placeholder={t('pos.searchPlaceholder')}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        autoFocus
      />
      <ul className={styles.results}>
        {results.map((product) => (
          <li key={product.id}>
            <button
              type="button"
              className={styles.resultItem}
              onClick={() => onSelect(product)}
              disabled={product.stockQuantity <= 0}
            >
              <span className={styles.resultName}>{product.name}</span>
              <span className={styles.resultMeta}>
                {product.sku} · {product.price.toLocaleString()} RWF · {t('pos.stock')}:{' '}
                {product.stockQuantity}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 3: Write src/modules/pos/Cart.module.css**

```css
.cart {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-4);
  background-color: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
}

.title {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
}

.empty {
  margin: 0;
  color: var(--color-text-secondary);
  font-size: 0.875rem;
}

.list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

.itemInfo {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.itemName {
  font-size: 0.875rem;
  color: var(--color-text-primary);
}

.itemPrice {
  font-size: 0.75rem;
  color: var(--color-text-secondary);
}

.itemControls {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.quantityInput {
  width: 48px;
  padding: var(--space-1);
  background-color: var(--color-background);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  color: var(--color-text-primary);
  text-align: center;
}

.removeButton {
  background: none;
  border: none;
  color: var(--color-text-secondary);
  font-size: 1rem;
  cursor: pointer;
}

.total {
  display: flex;
  justify-content: space-between;
  padding-top: var(--space-3);
  border-top: 1px solid var(--color-border);
  font-weight: 600;
}
```

- [ ] **Step 4: Write src/modules/pos/Cart.tsx**

```typescript
import { useTranslation } from 'react-i18next';
import type { Product } from '@shared/ipc';
import styles from './Cart.module.css';

export interface CartLine {
  product: Product;
  quantity: number;
}

interface CartProps {
  lines: CartLine[];
  onQuantityChange: (productId: string, quantity: number) => void;
  onRemove: (productId: string) => void;
}

export function Cart({ lines, onQuantityChange, onRemove }: CartProps) {
  const { t } = useTranslation();
  const total = lines.reduce((sum, line) => sum + line.product.price * line.quantity, 0);

  return (
    <div className={styles.cart}>
      <h2 className={styles.title}>{t('pos.cart')}</h2>
      {lines.length === 0 ? (
        <p className={styles.empty}>{t('pos.emptyCart')}</p>
      ) : (
        <ul className={styles.list}>
          {lines.map((line) => (
            <li key={line.product.id} className={styles.item}>
              <div className={styles.itemInfo}>
                <span className={styles.itemName}>{line.product.name}</span>
                <span className={styles.itemPrice}>
                  {line.product.price.toLocaleString()} RWF
                </span>
              </div>
              <div className={styles.itemControls}>
                <input
                  type="number"
                  min={1}
                  max={line.product.stockQuantity}
                  value={line.quantity}
                  onChange={(event) =>
                    onQuantityChange(line.product.id, Number(event.target.value))
                  }
                  className={styles.quantityInput}
                />
                <button
                  type="button"
                  className={styles.removeButton}
                  onClick={() => onRemove(line.product.id)}
                  aria-label={t('pos.remove')}
                >
                  &times;
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className={styles.total}>
        <span>{t('pos.total')}</span>
        <span>{total.toLocaleString()} RWF</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Verify typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add src/modules/pos/ProductSearch.tsx src/modules/pos/ProductSearch.module.css src/modules/pos/Cart.tsx src/modules/pos/Cart.module.css
git commit -m "Add product search and cart components"
```

---

### Task 7: Checkout and receipt components

**Files:**

- Create: `src/modules/pos/CheckoutPanel.module.css`
- Create: `src/modules/pos/CheckoutPanel.tsx`
- Create: `src/modules/pos/ReceiptView.module.css`
- Create: `src/modules/pos/ReceiptView.tsx`

- [ ] **Step 1: Write src/modules/pos/CheckoutPanel.module.css**

```css
.panel {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-4);
  background-color: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
}

.methodToggle {
  display: flex;
  gap: var(--space-2);
}

.methodButton {
  flex: 1;
  padding: var(--space-2);
  background-color: var(--color-background);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  color: var(--color-text-secondary);
  cursor: pointer;
}

.methodButton[data-active='true'] {
  border-color: var(--color-focus-ring);
  color: var(--color-text-primary);
}

.field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  font-size: 0.875rem;
  color: var(--color-text-secondary);
}

.field input {
  padding: var(--space-2) var(--space-3);
  background-color: var(--color-background);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  color: var(--color-text-primary);
  font-size: 1rem;
}

.change {
  margin: 0;
  font-size: 0.875rem;
  color: var(--color-text-secondary);
}

.error {
  margin: 0;
  color: #e5484d;
  font-size: 0.875rem;
}

.checkoutButton {
  padding: var(--space-3);
  background-color: var(--color-focus-ring);
  border: none;
  border-radius: var(--radius-md);
  color: white;
  font-weight: 600;
  cursor: pointer;
}

.checkoutButton:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
```

- [ ] **Step 2: Write src/modules/pos/CheckoutPanel.tsx**

```typescript
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PaymentMethod, Sale } from '@shared/ipc';
import type { CartLine } from './Cart';
import styles from './CheckoutPanel.module.css';

interface CheckoutPanelProps {
  lines: CartLine[];
  onCompleted: (sale: Sale) => void;
}

export function CheckoutPanel({ lines, onCompleted }: CheckoutPanelProps) {
  const { t } = useTranslation();
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CASH');
  const [amountTendered, setAmountTendered] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const total = lines.reduce((sum, line) => sum + line.product.price * line.quantity, 0);
  const tenderedValue = Number(amountTendered);
  const change = paymentMethod === 'CASH' && tenderedValue > total ? tenderedValue - total : 0;
  const canCheckout =
    lines.length > 0 &&
    (paymentMethod === 'MOBILE_MONEY' || (amountTendered !== '' && tenderedValue >= total));

  const handleCheckout = async () => {
    setError(null);
    setIsSubmitting(true);
    const result = await window.omnes?.createSale({
      items: lines.map((line) => ({ productId: line.product.id, quantity: line.quantity })),
      paymentMethod,
      amountTendered: paymentMethod === 'CASH' ? tenderedValue : null,
    });
    setIsSubmitting(false);

    if (result?.success && result.sale) {
      setAmountTendered('');
      onCompleted(result.sale);
    } else {
      setError(result?.message ?? t('pos.checkoutError'));
    }
  };

  return (
    <div className={styles.panel}>
      <div className={styles.methodToggle}>
        <button
          type="button"
          className={styles.methodButton}
          data-active={paymentMethod === 'CASH'}
          onClick={() => setPaymentMethod('CASH')}
        >
          {t('pos.cash')}
        </button>
        <button
          type="button"
          className={styles.methodButton}
          data-active={paymentMethod === 'MOBILE_MONEY'}
          onClick={() => setPaymentMethod('MOBILE_MONEY')}
        >
          {t('pos.mobileMoney')}
        </button>
      </div>
      {paymentMethod === 'CASH' && (
        <label className={styles.field}>
          <span>{t('pos.amountTendered')}</span>
          <input
            type="number"
            min={0}
            value={amountTendered}
            onChange={(event) => setAmountTendered(event.target.value)}
          />
        </label>
      )}
      {paymentMethod === 'CASH' && change > 0 && (
        <p className={styles.change}>
          {t('pos.change')}: {change.toLocaleString()} RWF
        </p>
      )}
      {error && <p className={styles.error}>{error}</p>}
      <button
        type="button"
        className={styles.checkoutButton}
        onClick={() => void handleCheckout()}
        disabled={!canCheckout || isSubmitting}
      >
        {isSubmitting ? t('pos.processing') : t('pos.checkout')}
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Write src/modules/pos/ReceiptView.module.css**

```css
.wrapper {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-4);
  max-width: 360px;
  margin: 0 auto;
}

.receipt {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-6);
  background-color: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
}

.brand {
  margin: 0;
  text-align: center;
  font-size: 1.125rem;
  font-weight: 600;
}

.timestamp,
.cashier {
  margin: 0;
  text-align: center;
  font-size: 0.75rem;
  color: var(--color-text-secondary);
}

.items {
  list-style: none;
  margin: var(--space-3) 0;
  padding: var(--space-3) 0;
  border-top: 1px dashed var(--color-border);
  border-bottom: 1px dashed var(--color-border);
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  font-size: 0.875rem;
}

.item {
  display: flex;
  justify-content: space-between;
}

.total {
  display: flex;
  justify-content: space-between;
  font-weight: 600;
}

.row {
  display: flex;
  justify-content: space-between;
  font-size: 0.875rem;
  color: var(--color-text-secondary);
}

.actions {
  display: flex;
  gap: var(--space-3);
  width: 100%;
}

.actions button {
  flex: 1;
  padding: var(--space-3);
  border-radius: var(--radius-md);
  cursor: pointer;
}

.actions button:first-child {
  background-color: var(--color-focus-ring);
  border: none;
  color: white;
  font-weight: 600;
}

.actions button:last-child {
  background: none;
  border: 1px solid var(--color-border);
  color: var(--color-text-secondary);
}
```

- [ ] **Step 4: Write src/modules/pos/ReceiptView.tsx**

```typescript
import { useTranslation } from 'react-i18next';
import type { Sale } from '@shared/ipc';
import styles from './ReceiptView.module.css';

interface ReceiptViewProps {
  sale: Sale;
  onDone: () => void;
}

export function ReceiptView({ sale, onDone }: ReceiptViewProps) {
  const { t } = useTranslation();

  return (
    <div className={styles.wrapper}>
      <div className={styles.receipt}>
        <h1 className={styles.brand}>{t('app.name')}</h1>
        <p className={styles.timestamp}>{new Date(sale.createdAt).toLocaleString()}</p>
        {sale.cashierUsername && (
          <p className={styles.cashier}>
            {t('pos.cashier')}: {sale.cashierUsername}
          </p>
        )}
        <ul className={styles.items}>
          {sale.items.map((item) => (
            <li key={item.id} className={styles.item}>
              <span>
                {item.quantity} × {item.productName}
              </span>
              <span>{(item.unitPrice * item.quantity).toLocaleString()} RWF</span>
            </li>
          ))}
        </ul>
        <div className={styles.total}>
          <span>{t('pos.total')}</span>
          <span>{sale.total.toLocaleString()} RWF</span>
        </div>
        {sale.paymentMethod === 'CASH' && (
          <>
            <div className={styles.row}>
              <span>{t('pos.amountTendered')}</span>
              <span>{sale.amountTendered?.toLocaleString()} RWF</span>
            </div>
            <div className={styles.row}>
              <span>{t('pos.change')}</span>
              <span>{sale.changeGiven?.toLocaleString()} RWF</span>
            </div>
          </>
        )}
        {sale.paymentMethod === 'MOBILE_MONEY' && (
          <p className={styles.row}>{t('pos.mobileMoney')}</p>
        )}
      </div>
      <div className={styles.actions}>
        <button type="button" onClick={() => window.print()}>
          {t('pos.print')}
        </button>
        <button type="button" onClick={onDone}>
          {t('pos.close')}
        </button>
      </div>
    </div>
  );
}
```

`onDone`'s button is labeled "Close" (not "New sale") because
`ReceiptView` is reused for two cases — a just-completed sale and a
reopened historical one — and "Close" (return to the main POS screen)
is accurate for both, where "New sale" would be misleading for the
second case.

- [ ] **Step 5: Verify typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add src/modules/pos/CheckoutPanel.tsx src/modules/pos/CheckoutPanel.module.css src/modules/pos/ReceiptView.tsx src/modules/pos/ReceiptView.module.css
git commit -m "Add checkout and receipt components"
```

---

### Task 8: Sale history and the POS page orchestrator

**Files:**

- Create: `src/modules/pos/SaleHistory.module.css`
- Create: `src/modules/pos/SaleHistory.tsx`
- Create: `src/modules/pos/PosPage.module.css`
- Create: `src/modules/pos/PosPage.tsx`

- [ ] **Step 1: Write src/modules/pos/SaleHistory.module.css**

```css
.history {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.title {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
}

.list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.item {
  width: 100%;
  display: flex;
  justify-content: space-between;
  padding: var(--space-2) var(--space-3);
  background: none;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  color: var(--color-text-secondary);
  font-size: 0.8125rem;
  cursor: pointer;
}
```

- [ ] **Step 2: Write src/modules/pos/SaleHistory.tsx**

```typescript
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Sale } from '@shared/ipc';
import styles from './SaleHistory.module.css';

interface SaleHistoryProps {
  onOpenSale: (sale: Sale) => void;
}

export function SaleHistory({ onOpenSale }: SaleHistoryProps) {
  const { t } = useTranslation();
  const [sales, setSales] = useState<Sale[]>([]);

  useEffect(() => {
    let cancelled = false;
    window.omnes
      ?.listSales()
      .then((list) => {
        if (!cancelled) setSales(list);
      })
      .catch((error: unknown) => {
        console.error('Failed to list sales', error);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (sales.length === 0) {
    return null;
  }

  return (
    <div className={styles.history}>
      <h2 className={styles.title}>{t('pos.recentSales')}</h2>
      <ul className={styles.list}>
        {sales.slice(0, 10).map((sale) => (
          <li key={sale.id}>
            <button type="button" className={styles.item} onClick={() => onOpenSale(sale)}>
              <span>{new Date(sale.createdAt).toLocaleString()}</span>
              <span>{sale.total.toLocaleString()} RWF</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

`SaleHistory` only fetches on mount — `PosPage` conditionally renders
either this list or `ReceiptView`, so returning from a just-completed
sale back to the list genuinely remounts `SaleHistory` (React unmounted
it while `ReceiptView` was showing), which is what makes the newest sale
appear without any extra refetch plumbing.

- [ ] **Step 3: Write src/modules/pos/PosPage.module.css**

```css
.page {
  display: grid;
  grid-template-columns: 1fr 360px;
  gap: var(--space-6);
  height: 100%;
  align-items: start;
}

.mainColumn {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  min-width: 0;
}

.cartColumn {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  position: sticky;
  top: 0;
}

.title {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
}
```

- [ ] **Step 4: Write src/modules/pos/PosPage.tsx**

```typescript
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Product, Sale } from '@shared/ipc';
import { ProductSearch } from './ProductSearch';
import { Cart, type CartLine } from './Cart';
import { CheckoutPanel } from './CheckoutPanel';
import { ReceiptView } from './ReceiptView';
import { SaleHistory } from './SaleHistory';
import styles from './PosPage.module.css';

export function PosPage() {
  const { t } = useTranslation();
  const [cartLines, setCartLines] = useState<CartLine[]>([]);
  const [completedSale, setCompletedSale] = useState<Sale | null>(null);
  const [viewingSale, setViewingSale] = useState<Sale | null>(null);

  const handleAddProduct = (product: Product) => {
    setCartLines((current) => {
      const existing = current.find((line) => line.product.id === product.id);
      if (existing) {
        return current.map((line) =>
          line.product.id === product.id ? { ...line, quantity: line.quantity + 1 } : line,
        );
      }
      return [...current, { product, quantity: 1 }];
    });
  };

  const handleQuantityChange = (productId: string, quantity: number) => {
    setCartLines((current) =>
      quantity <= 0
        ? current.filter((line) => line.product.id !== productId)
        : current.map((line) => (line.product.id === productId ? { ...line, quantity } : line)),
    );
  };

  const handleRemove = (productId: string) => {
    setCartLines((current) => current.filter((line) => line.product.id !== productId));
  };

  const handleSaleCompleted = (sale: Sale) => {
    setCartLines([]);
    setCompletedSale(sale);
  };

  if (completedSale) {
    return <ReceiptView sale={completedSale} onDone={() => setCompletedSale(null)} />;
  }

  if (viewingSale) {
    return <ReceiptView sale={viewingSale} onDone={() => setViewingSale(null)} />;
  }

  return (
    <div className={styles.page}>
      <div className={styles.mainColumn}>
        <h1 className={styles.title}>{t('modules.pos')}</h1>
        <ProductSearch onSelect={handleAddProduct} />
        <SaleHistory onOpenSale={setViewingSale} />
      </div>
      <div className={styles.cartColumn}>
        <Cart lines={cartLines} onQuantityChange={handleQuantityChange} onRemove={handleRemove} />
        <CheckoutPanel lines={cartLines} onCompleted={handleSaleCompleted} />
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Verify typecheck, lint, and tests**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: zero errors, all tests passing.

- [ ] **Step 6: Commit**

```bash
git add src/modules/pos/SaleHistory.tsx src/modules/pos/SaleHistory.module.css src/modules/pos/PosPage.tsx src/modules/pos/PosPage.module.css
git commit -m "Add sale history and the POS page"
```

---

### Task 9: Enable the POS route

**Files:**

- Modify: `src/app/AppShell.tsx`
- Modify: `src/app/App.tsx`

- [ ] **Step 1: Flip the POS nav item to enabled in AppShell.tsx**

```typescript
const MODULE_NAV = [
  { key: 'modules.core', path: '/', enabled: true },
  { key: 'modules.pos', path: '/pos', enabled: true },
  { key: 'modules.inventory', path: '/inventory', enabled: true },
  { key: 'modules.crm', path: '/crm', enabled: false },
  { key: 'modules.reports', path: '/reports', enabled: false },
  { key: 'modules.admin', path: '/admin', enabled: true },
] as const;
```

- [ ] **Step 2: Add the route in App.tsx**

Add the import:

```typescript
import { PosPage } from '../modules/pos/PosPage';
```

Add the route alongside the existing ones:

```tsx
                <Route path="inventory" element={<ProductsPage />} />
                <Route path="pos" element={<PosPage />} />
```

- [ ] **Step 3: Verify typecheck, lint, and tests**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: zero errors, all tests passing.

- [ ] **Step 4: Commit**

```bash
git add src/app/AppShell.tsx src/app/App.tsx
git commit -m "Enable the POS route"
```

---

### Task 10: Extend the e2e test

**Files:**

- Modify: `tests/e2e/app.spec.ts`

- [ ] **Step 1: Add a full checkout round trip after the existing product-creation block**

Add right before `await app.close();`:

```typescript
await window.getByRole('link', { name: 'Point of Sale' }).click();
await window.getByPlaceholder('Search products by name, SKU, or barcode').fill('E2E Test Widget');
await window.getByText('E2E Test Widget').first().click();
await window.getByRole('button', { name: 'Cash' }).click();
await window.getByLabel('Amount tendered').fill('2000');
await window.getByRole('button', { name: 'Checkout' }).click();
await expect(window.getByRole('button', { name: 'Print' })).toBeVisible({ timeout: 10_000 });
await expect(window.getByText(/E2E Test Widget/)).toBeVisible();
await window.getByRole('button', { name: 'Close' }).click();

await window.getByRole('link', { name: 'Inventory' }).click();
// The widget was created with stock 5 in the Inventory block above and
// just sold 1 here — .first() because the product NAME repeats across
// local re-runs (unique SKU only), same reasoning as every other .first()
// in this file; every run's row ends at stock 4 regardless of which
// run's row this picks, since every run creates 5 and sells 1.
await expect(window.locator('tr', { hasText: 'E2E Test Widget' }).first()).toContainText('4');
```

- [ ] **Step 2: Rebuild and run the e2e tests**

Run: `pnpm build && pnpm exec playwright test`
Expected: both tests PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/app.spec.ts
git commit -m "Extend e2e test to verify a full POS checkout"
```

---

### Task 11: Documentation, final verification, and merge

**Files:**

- Modify: `docs/architecture.md`

- [ ] **Step 1: Add a POS Sale Flow section to docs/architecture.md, before the IPC contract section**

Cover: why `createSale`'s transaction needs `Serializable` isolation
specifically (not just any `$transaction`) and how that maps to the
`createFirstAdmin` precedent from Authentication; the snapshot fields on
`Sale`/`SaleItem` (cashier username, product name/price) and why —
history must survive a later product rename/re-price or user deletion;
that cart-building is pure renderer state with no IPC round trip until
checkout; and that receipts print via the OS dialog
(`window.print()`/`webContents.print()`), not a vendor thermal-printer SDK.

- [ ] **Step 2: Run the full local verification suite**

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm package
```

Expected: every command exits 0.

- [ ] **Step 3: Push the branch and open a PR**

```bash
git push -u origin feature/pos-sale-flow
```

- [ ] **Step 4: Verify CI passes on GitHub, dispatch an independent code-review subagent, address findings**

Follow the same pattern as every prior sub-project: once CI is green,
dispatch a fresh subagent to review the full branch diff against this
plan and the design spec before merging. Given this sub-project introduces
the app's second `Serializable`-isolation transaction and its first
genuine money-handling logic (totals, change, stock deduction), review
that transaction's correctness with the same rigor Authentication's race
condition fix received.

- [ ] **Step 5: Merge via the finishing-a-development-branch skill once CI is green and review findings are addressed**
