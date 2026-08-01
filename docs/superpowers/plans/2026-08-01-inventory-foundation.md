# Inventory Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `Product` model with catalog CRUD (add/edit/deactivate), giving the Inventory sidebar entry real content for the first time — the foundational data every later business module (POS, Reports, CRM) needs to exist first.

**Architecture:** `products.ts` holds thin CRUD functions directly against `prisma.product`, returning a `ProductResult` shape (`{ success, message, product }`) from every mutating call so IPC handlers stay pure passthroughs, matching `backup-manager.ts`'s convention. No pure-logic file is needed here (unlike `backup.ts`'s date math) — this is straightforward validated CRUD, tested directly against the real local database the same way `auth.ts` is. `ProductsPage.tsx` toggles between a table view and `ProductForm.tsx` (shared between add and edit) rather than two separate screens.

**Tech Stack:** No new npm dependencies — reuses Prisma, React Hook Form, Zod, and the existing CSS token set.

---

### Task 1: Product model and migration

**Files:**

- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add the Product model**

Add to `prisma/schema.prisma`, after the `AuditLog` model:

```prisma
model Product {
  id            String   @id @default(uuid())
  name          String
  sku           String   @unique
  barcode       String?  @unique
  category      String
  price         Int
  stockQuantity Int
  isActive      Boolean  @default(true)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
}
```

`price` and `stockQuantity` are plain `Int` — RWF has no commonly-used
subunit, so whole numbers avoid floating-point money bugs entirely.
`barcode` is nullable with its own unique constraint; Postgres unique
constraints don't treat `NULL`s as equal to each other, so any number of
products can have no barcode yet without conflicting.

- [ ] **Step 2: Generate and apply the migration**

Run: `pnpm exec prisma migrate dev --name add_product`
(Not `pnpm run db:migrate -- --name add_product` — the established `--`
passthrough gotcha from Database Foundation still applies.)
Expected: a new folder under `prisma/migrations/` and the local `omnes_dev`
database now has a `Product` table.

- [ ] **Step 3: Verify typecheck**

Run: `pnpm typecheck`
Expected: zero errors — the schema change alone doesn't touch any
TypeScript consumer yet.

- [ ] **Step 4: Commit**

```bash
git checkout main
git pull
git checkout -b feature/inventory-foundation
git add prisma/schema.prisma prisma/migrations
git commit -m "Add the Product model"
```

---

### Task 2: Shared product types

**Files:**

- Modify: `shared/ipc.ts`

- [ ] **Step 1: Add product channels, types, and AppApi members to shared/ipc.ts**

Add to `IPC_CHANNELS`:

```typescript
  listProducts: 'product:list',
  createProduct: 'product:create',
  updateProduct: 'product:update',
  setProductActive: 'product:set-active',
```

Add after the `NotificationRecord`/`NotifyInput`-adjacent types (anywhere after `LicenseInfo` is fine):

```typescript
export interface Product {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  category: string;
  price: number;
  stockQuantity: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProductInput {
  name: string;
  sku: string;
  barcode: string | null;
  category: string;
  price: number;
  stockQuantity: number;
}

export interface ProductResult {
  success: boolean;
  message: string;
  product: Product | null;
}
```

Add to `AppApi`:

```typescript
listProducts: (includeInactive?: boolean) => Promise<Product[]>;
createProduct: (input: ProductInput) => Promise<ProductResult>;
updateProduct: (id: string, input: Partial<ProductInput>) => Promise<ProductResult>;
setProductActive: (id: string, isActive: boolean) => Promise<ProductResult>;
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm typecheck`
Expected: fails — `electron/preload/index.ts` doesn't implement the new
`AppApi` members yet, fixed in Task 4. Confirm the failure is specifically
about the missing members.

- [ ] **Step 3: Commit**

```bash
git add shared/ipc.ts
git commit -m "Add product types to the shared IPC contract"
```

---

### Task 3: Product CRUD service, with tests

**Files:**

- Create: `tests/unit/products.test.ts`
- Create: `electron/main/services/core/products.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import {
  createProduct,
  listProducts,
  setProductActive,
  updateProduct,
} from '../../electron/main/services/core/products';
import { prisma } from '../../electron/main/services/core/database';

function uniqueSku(): string {
  return `TEST-${randomUUID()}`;
}

describe('products', () => {
  afterAll(async () => {
    await prisma.product.deleteMany({ where: { sku: { startsWith: 'TEST-' } } });
    await prisma.$disconnect();
  });

  it('creates and lists a product', async () => {
    const sku = uniqueSku();
    const result = await createProduct({
      name: 'Test Widget',
      sku,
      barcode: null,
      category: 'Widgets',
      price: 1500,
      stockQuantity: 10,
    });

    expect(result.success).toBe(true);
    expect(result.product?.sku).toBe(sku);

    const products = await listProducts();
    expect(products.some((product) => product.sku === sku)).toBe(true);
  });

  it('rejects a duplicate SKU', async () => {
    const sku = uniqueSku();
    await createProduct({
      name: 'First',
      sku,
      barcode: null,
      category: 'Widgets',
      price: 100,
      stockQuantity: 1,
    });

    const result = await createProduct({
      name: 'Second',
      sku,
      barcode: null,
      category: 'Widgets',
      price: 200,
      stockQuantity: 2,
    });

    expect(result.success).toBe(false);
    expect(result.message).toBe('SKU already in use');
  });

  it('rejects a negative price', async () => {
    const result = await createProduct({
      name: 'Bad Widget',
      sku: uniqueSku(),
      barcode: null,
      category: 'Widgets',
      price: -100,
      stockQuantity: 1,
    });

    expect(result.success).toBe(false);
    expect(result.message).toBe('Price cannot be negative');
  });

  it('updates a product', async () => {
    const created = await createProduct({
      name: 'Before',
      sku: uniqueSku(),
      barcode: null,
      category: 'Widgets',
      price: 100,
      stockQuantity: 1,
    });
    const id = created.product?.id as string;

    const updated = await updateProduct(id, { name: 'After', price: 200 });

    expect(updated.success).toBe(true);
    expect(updated.product?.name).toBe('After');
    expect(updated.product?.price).toBe(200);
  });

  it('deactivates and reactivates a product without deleting it', async () => {
    const created = await createProduct({
      name: 'Togglable',
      sku: uniqueSku(),
      barcode: null,
      category: 'Widgets',
      price: 100,
      stockQuantity: 1,
    });
    const id = created.product?.id as string;

    const deactivated = await setProductActive(id, false);
    expect(deactivated.success).toBe(true);
    expect(deactivated.product?.isActive).toBe(false);

    const activeList = await listProducts();
    expect(activeList.some((product) => product.id === id)).toBe(false);

    const fullList = await listProducts(true);
    expect(fullList.some((product) => product.id === id)).toBe(true);

    const reactivated = await setProductActive(id, true);
    expect(reactivated.success).toBe(true);
    expect(reactivated.product?.isActive).toBe(true);
  });
});
```

This runs real CRUD against the real local database (create, list, update,
deactivate/reactivate, and the duplicate-SKU rejection path), matching the
project's established "test real behavior" philosophy. `TEST-` prefixed
SKUs are cleaned up in `afterAll` so repeated local runs don't accumulate
rows the way the Backup sub-project's e2e history did.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test`
Expected: FAIL — `Cannot find module '../../electron/main/services/core/products'`.

- [ ] **Step 3: Write electron/main/services/core/products.ts**

```typescript
import { Prisma } from '../../../../generated/prisma/client';
import { prisma } from './database';
import type { Product, ProductInput, ProductResult } from '@shared/ipc';

interface ProductRow {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  category: string;
  price: number;
  stockQuantity: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

function toProduct(row: ProductRow): Product {
  return {
    id: row.id,
    name: row.name,
    sku: row.sku,
    barcode: row.barcode,
    category: row.category,
    price: row.price,
    stockQuantity: row.stockQuantity,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function validateInput(input: Partial<ProductInput>): void {
  if (input.name !== undefined && input.name.trim().length === 0) {
    throw new Error('Product name is required');
  }
  if (input.sku !== undefined && input.sku.trim().length === 0) {
    throw new Error('SKU is required');
  }
  if (input.price !== undefined && input.price < 0) {
    throw new Error('Price cannot be negative');
  }
  if (input.stockQuantity !== undefined && input.stockQuantity < 0) {
    throw new Error('Stock quantity cannot be negative');
  }
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    const target = (error.meta?.target as string[] | undefined) ?? [];
    if (target.includes('sku')) {
      return 'SKU already in use';
    }
    if (target.includes('barcode')) {
      return 'Barcode already in use';
    }
  }
  return error instanceof Error ? error.message : String(error);
}

export async function listProducts(includeInactive = false): Promise<Product[]> {
  const rows = await prisma.product.findMany({
    where: includeInactive ? undefined : { isActive: true },
    orderBy: { name: 'asc' },
  });
  return rows.map(toProduct);
}

export async function createProduct(input: ProductInput): Promise<ProductResult> {
  try {
    validateInput(input);
    const row = await prisma.product.create({
      data: {
        name: input.name.trim(),
        sku: input.sku.trim(),
        barcode: input.barcode?.trim() || null,
        category: input.category.trim(),
        price: input.price,
        stockQuantity: input.stockQuantity,
      },
    });
    return { success: true, message: 'Product created', product: toProduct(row) };
  } catch (error) {
    return { success: false, message: toErrorMessage(error), product: null };
  }
}

export async function updateProduct(
  id: string,
  input: Partial<ProductInput>,
): Promise<ProductResult> {
  try {
    validateInput(input);
    const row = await prisma.product.update({
      where: { id },
      data: {
        ...(input.name !== undefined && { name: input.name.trim() }),
        ...(input.sku !== undefined && { sku: input.sku.trim() }),
        ...(input.barcode !== undefined && { barcode: input.barcode?.trim() || null }),
        ...(input.category !== undefined && { category: input.category.trim() }),
        ...(input.price !== undefined && { price: input.price }),
        ...(input.stockQuantity !== undefined && { stockQuantity: input.stockQuantity }),
      },
    });
    return { success: true, message: 'Product updated', product: toProduct(row) };
  } catch (error) {
    return { success: false, message: toErrorMessage(error), product: null };
  }
}

export async function setProductActive(id: string, isActive: boolean): Promise<ProductResult> {
  try {
    const row = await prisma.product.update({
      where: { id },
      data: { isActive },
    });
    return {
      success: true,
      message: isActive ? 'Product reactivated' : 'Product deactivated',
      product: toProduct(row),
    };
  } catch (error) {
    return { success: false, message: toErrorMessage(error), product: null };
  }
}
```

This file imports nothing from `electron` — only the generated Prisma
client and `database.ts` (which itself has no Electron dependency) — so
it's directly unit-testable, matching `auth.ts`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test`
Expected: PASS — all five new tests plus every pre-existing test.

- [ ] **Step 5: Verify typecheck**

Run: `pnpm typecheck`
Expected: same pre-existing `AppApi` failure as Task 2, nothing new.

- [ ] **Step 6: Commit**

```bash
git add tests/unit/products.test.ts electron/main/services/core/products.ts
git commit -m "Add product CRUD service"
```

---

### Task 4: Wire the product IPC channels

**Files:**

- Modify: `electron/preload/index.ts`
- Modify: `electron/main/ipc/index.ts`

- [ ] **Step 1: Add the product methods to electron/preload/index.ts**

Add to the `api` object:

```typescript
  listProducts: (includeInactive) => ipcRenderer.invoke(IPC_CHANNELS.listProducts, includeInactive),
  createProduct: (input) => ipcRenderer.invoke(IPC_CHANNELS.createProduct, input),
  updateProduct: (id, input) => ipcRenderer.invoke(IPC_CHANNELS.updateProduct, id, input),
  setProductActive: (id, isActive) =>
    ipcRenderer.invoke(IPC_CHANNELS.setProductActive, id, isActive),
```

- [ ] **Step 2: Add the handlers to electron/main/ipc/index.ts**

Add the import:

```typescript
import {
  createProduct,
  listProducts,
  setProductActive,
  updateProduct,
} from '../services/core/products';
```

Add `Product`, `ProductInput`, and `ProductResult` to the existing `@shared/ipc` type import.

Add inside `registerIpcHandlers()`:

```typescript
ipcMain.handle(IPC_CHANNELS.listProducts, (_event, includeInactive?: boolean): Promise<Product[]> =>
  listProducts(includeInactive),
);

ipcMain.handle(IPC_CHANNELS.createProduct, (_event, input: ProductInput): Promise<ProductResult> =>
  createProduct(input),
);

ipcMain.handle(
  IPC_CHANNELS.updateProduct,
  (_event, id: string, input: Partial<ProductInput>): Promise<ProductResult> =>
    updateProduct(id, input),
);

ipcMain.handle(
  IPC_CHANNELS.setProductActive,
  (_event, id: string, isActive: boolean): Promise<ProductResult> => setProductActive(id, isActive),
);
```

- [ ] **Step 3: Verify typecheck**

Run: `pnpm typecheck`
Expected: zero errors — this is what makes Task 2's expected failure go away.

- [ ] **Step 4: Verify lint and tests**

Run: `pnpm lint && pnpm test`
Expected: zero errors, all tests passing.

- [ ] **Step 5: Commit**

```bash
git add electron/preload/index.ts electron/main/ipc/index.ts
git commit -m "Wire product IPC channels"
```

---

### Task 5: Product locale strings

**Files:**

- Modify: `src/locales/en.json`, `src/locales/rw.json`, `src/locales/fr.json`

- [ ] _*Step 1: Add inventory.* keys to all three locale files_*

Add to `src/locales/en.json` (after the `notifications.*` keys, before `modules.*`):

```json
  "inventory.addProduct": "Add product",
  "inventory.editProduct": "Edit product",
  "inventory.name": "Name",
  "inventory.sku": "SKU",
  "inventory.barcode": "Barcode",
  "inventory.category": "Category",
  "inventory.price": "Price (RWF)",
  "inventory.stockQuantity": "Stock quantity",
  "inventory.status": "Status",
  "inventory.active": "Active",
  "inventory.inactive": "Inactive",
  "inventory.edit": "Edit",
  "inventory.deactivate": "Deactivate",
  "inventory.reactivate": "Reactivate",
  "inventory.cancel": "Cancel",
  "inventory.saveChanges": "Save changes",
  "inventory.loading": "Loading...",
  "inventory.noProducts": "No products yet.",
```

Add to `src/locales/rw.json`:

```json
  "inventory.addProduct": "Ongeraho igicuruzwa",
  "inventory.editProduct": "Hindura igicuruzwa",
  "inventory.name": "Izina",
  "inventory.sku": "SKU",
  "inventory.barcode": "Kode y'igicuruzwa",
  "inventory.category": "Icyiciro",
  "inventory.price": "Igiciro (RWF)",
  "inventory.stockQuantity": "Umubare uri mu bubiko",
  "inventory.status": "Uko bimeze",
  "inventory.active": "Birakoreshwa",
  "inventory.inactive": "Ntibikoreshwa",
  "inventory.edit": "Hindura",
  "inventory.deactivate": "Hagarika",
  "inventory.reactivate": "Ongera ukoreshe",
  "inventory.cancel": "Hagarika",
  "inventory.saveChanges": "Bika impinduka",
  "inventory.loading": "Turacyategura...",
  "inventory.noProducts": "Nta bicuruzwa bihari.",
```

Add to `src/locales/fr.json`:

```json
  "inventory.addProduct": "Ajouter un produit",
  "inventory.editProduct": "Modifier le produit",
  "inventory.name": "Nom",
  "inventory.sku": "SKU",
  "inventory.barcode": "Code-barres",
  "inventory.category": "Catégorie",
  "inventory.price": "Prix (RWF)",
  "inventory.stockQuantity": "Quantité en stock",
  "inventory.status": "Statut",
  "inventory.active": "Actif",
  "inventory.inactive": "Inactif",
  "inventory.edit": "Modifier",
  "inventory.deactivate": "Désactiver",
  "inventory.reactivate": "Réactiver",
  "inventory.cancel": "Annuler",
  "inventory.saveChanges": "Enregistrer",
  "inventory.loading": "Chargement...",
  "inventory.noProducts": "Aucun produit pour le moment.",
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm typecheck`
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/locales
git commit -m "Add inventory locale strings"
```

---

### Task 6: Product form (shared between add and edit)

**Files:**

- Create: `src/modules/inventory/ProductForm.schema.ts`
- Create: `src/modules/inventory/ProductForm.module.css`
- Create: `src/modules/inventory/ProductForm.tsx`

- [ ] **Step 1: Write src/modules/inventory/ProductForm.schema.ts**

```typescript
import { z } from 'zod';

export const productFormSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  sku: z.string().trim().min(1, 'SKU is required'),
  barcode: z.string().trim(),
  category: z.string().trim().min(1, 'Category is required'),
  price: z.coerce.number().int().min(0, 'Price cannot be negative'),
  stockQuantity: z.coerce.number().int().min(0, 'Stock quantity cannot be negative'),
});

export type ProductFormValues = z.infer<typeof productFormSchema>;
```

- [ ] **Step 2: Write src/modules/inventory/ProductForm.module.css**

```css
.form {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  max-width: 400px;
}

.title {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
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

.fieldError {
  color: #e5484d;
  font-size: 0.75rem;
}

.actions {
  display: flex;
  gap: var(--space-3);
}

.actions button[type='submit'] {
  padding: var(--space-3);
  background-color: var(--color-focus-ring);
  border: none;
  border-radius: var(--radius-md);
  color: white;
  font-weight: 600;
  cursor: pointer;
}

.actions button[type='submit']:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.actions button[type='button'] {
  padding: var(--space-3);
  background: none;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  color: var(--color-text-secondary);
  cursor: pointer;
}
```

- [ ] **Step 3: Write src/modules/inventory/ProductForm.tsx**

```typescript
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import type { Product } from '@shared/ipc';
import { productFormSchema, type ProductFormValues } from './ProductForm.schema';
import styles from './ProductForm.module.css';

interface ProductFormProps {
  product?: Product;
  onSaved: () => void;
  onCancel: () => void;
}

export function ProductForm({ product, onSaved, onCancel }: ProductFormProps) {
  const { t } = useTranslation();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ProductFormValues>({
    resolver: zodResolver(productFormSchema),
    defaultValues: {
      name: product?.name ?? '',
      sku: product?.sku ?? '',
      barcode: product?.barcode ?? '',
      category: product?.category ?? '',
      price: product?.price ?? 0,
      stockQuantity: product?.stockQuantity ?? 0,
    },
  });

  const onSubmit = handleSubmit(async (values) => {
    const input = {
      name: values.name,
      sku: values.sku,
      barcode: values.barcode || null,
      category: values.category,
      price: values.price,
      stockQuantity: values.stockQuantity,
    };

    const result = product
      ? await window.omnes?.updateProduct(product.id, input)
      : await window.omnes?.createProduct(input);

    if (result?.success) {
      onSaved();
    }
  });

  return (
    <form className={styles.form} onSubmit={onSubmit} noValidate>
      <h2 className={styles.title}>
        {product ? t('inventory.editProduct') : t('inventory.addProduct')}
      </h2>
      <label className={styles.field}>
        <span>{t('inventory.name')}</span>
        <input type="text" autoFocus {...register('name')} />
        {errors.name && <span className={styles.fieldError}>{errors.name.message}</span>}
      </label>
      <label className={styles.field}>
        <span>{t('inventory.sku')}</span>
        <input type="text" {...register('sku')} />
        {errors.sku && <span className={styles.fieldError}>{errors.sku.message}</span>}
      </label>
      <label className={styles.field}>
        <span>{t('inventory.barcode')}</span>
        <input type="text" {...register('barcode')} />
      </label>
      <label className={styles.field}>
        <span>{t('inventory.category')}</span>
        <input type="text" {...register('category')} />
        {errors.category && <span className={styles.fieldError}>{errors.category.message}</span>}
      </label>
      <label className={styles.field}>
        <span>{t('inventory.price')}</span>
        <input type="number" min={0} step={1} {...register('price')} />
        {errors.price && <span className={styles.fieldError}>{errors.price.message}</span>}
      </label>
      <label className={styles.field}>
        <span>{t('inventory.stockQuantity')}</span>
        <input type="number" min={0} step={1} {...register('stockQuantity')} />
        {errors.stockQuantity && (
          <span className={styles.fieldError}>{errors.stockQuantity.message}</span>
        )}
      </label>
      <div className={styles.actions}>
        <button type="button" onClick={onCancel}>
          {t('inventory.cancel')}
        </button>
        <button type="submit" disabled={isSubmitting}>
          {product ? t('inventory.saveChanges') : t('inventory.addProduct')}
        </button>
      </div>
    </form>
  );
}
```

`barcode` stays a plain (possibly empty) string in the form — `values.barcode || null` converts an empty string to `null` on submit, matching the schema's nullable field.

- [ ] **Step 4: Verify typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: zero errors (this file isn't imported anywhere yet, so no route-wiring failure is expected at this point).

- [ ] **Step 5: Commit**

```bash
git add src/modules/inventory/ProductForm.schema.ts src/modules/inventory/ProductForm.module.css src/modules/inventory/ProductForm.tsx
git commit -m "Add the product add/edit form"
```

---

### Task 7: Products page

**Files:**

- Create: `src/modules/inventory/ProductsPage.module.css`
- Create: `src/modules/inventory/ProductsPage.tsx`

- [ ] **Step 1: Write src/modules/inventory/ProductsPage.module.css**

```css
.page {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  max-width: 900px;
}

.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.title {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
}

.toolbar button {
  padding: var(--space-2) var(--space-4);
  background-color: var(--color-focus-ring);
  border: none;
  border-radius: var(--radius-md);
  color: white;
  font-weight: 600;
  cursor: pointer;
}

.empty {
  color: var(--color-text-secondary);
}

.table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.875rem;
}

.table th {
  text-align: left;
  padding: var(--space-2) var(--space-3);
  color: var(--color-text-secondary);
  font-weight: 600;
  border-bottom: 1px solid var(--color-border);
}

.table td {
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--color-border);
  color: var(--color-text-primary);
}

.table tr[data-active='false'] {
  opacity: 0.5;
}

.rowActions {
  display: flex;
  gap: var(--space-2);
}

.rowActions button {
  padding: var(--space-1) var(--space-3);
  background: none;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  color: var(--color-text-secondary);
  font-size: 0.75rem;
  cursor: pointer;
}

.rowActions button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
```

- [ ] **Step 2: Write src/modules/inventory/ProductsPage.tsx**

```typescript
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Product } from '@shared/ipc';
import { ProductForm } from './ProductForm';
import styles from './ProductsPage.module.css';

export function ProductsPage() {
  const { t } = useTranslation();
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const fetchProducts = async () => {
    const list = await window.omnes?.listProducts(true);
    setProducts(list ?? []);
    setIsLoading(false);
  };

  useEffect(() => {
    let cancelled = false;
    window.omnes
      ?.listProducts(true)
      .then((list) => {
        if (!cancelled) {
          setProducts(list);
          setIsLoading(false);
        }
      })
      .catch((error: unknown) => {
        console.error('Failed to list products', error);
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleToggleActive = async (product: Product) => {
    setBusyId(product.id);
    await window.omnes?.setProductActive(product.id, !product.isActive);
    setBusyId(null);
    await fetchProducts();
  };

  const handleSaved = () => {
    setIsAdding(false);
    setEditingProduct(null);
    void fetchProducts();
  };

  const handleCancel = () => {
    setIsAdding(false);
    setEditingProduct(null);
  };

  if (isAdding || editingProduct) {
    return (
      <ProductForm product={editingProduct ?? undefined} onSaved={handleSaved} onCancel={handleCancel} />
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <h1 className={styles.title}>{t('modules.inventory')}</h1>
        <button type="button" onClick={() => setIsAdding(true)}>
          {t('inventory.addProduct')}
        </button>
      </div>
      {isLoading ? (
        <p>{t('inventory.loading')}</p>
      ) : products.length === 0 ? (
        <p className={styles.empty}>{t('inventory.noProducts')}</p>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>{t('inventory.name')}</th>
              <th>{t('inventory.sku')}</th>
              <th>{t('inventory.category')}</th>
              <th>{t('inventory.price')}</th>
              <th>{t('inventory.stockQuantity')}</th>
              <th>{t('inventory.status')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {products.map((product) => (
              <tr key={product.id} data-active={product.isActive}>
                <td>{product.name}</td>
                <td>{product.sku}</td>
                <td>{product.category}</td>
                <td>{product.price.toLocaleString()}</td>
                <td>{product.stockQuantity}</td>
                <td>{product.isActive ? t('inventory.active') : t('inventory.inactive')}</td>
                <td className={styles.rowActions}>
                  <button type="button" onClick={() => setEditingProduct(product)}>
                    {t('inventory.edit')}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleToggleActive(product)}
                    disabled={busyId === product.id}
                  >
                    {product.isActive ? t('inventory.deactivate') : t('inventory.reactivate')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
```

The initial fetch in `useEffect` uses the `.then()`/`cancelled`-flag shape
(not the bare `fetchProducts()` call) to satisfy the same
`react-hooks/set-state-in-effect` lint rule `BackupPanel.tsx` and
`NotificationBell.tsx` already had to work around; `fetchProducts` itself
is reused freely from event handlers, where that rule doesn't apply.

- [ ] **Step 3: Verify typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add src/modules/inventory/ProductsPage.module.css src/modules/inventory/ProductsPage.tsx
git commit -m "Add the products page"
```

---

### Task 8: Enable the Inventory route

**Files:**

- Modify: `src/app/AppShell.tsx`
- Modify: `src/app/App.tsx`

- [ ] **Step 1: Flip the Inventory nav item to enabled in AppShell.tsx**

```typescript
const MODULE_NAV = [
  { key: 'modules.core', path: '/', enabled: true },
  { key: 'modules.pos', path: '/pos', enabled: false },
  { key: 'modules.inventory', path: '/inventory', enabled: true },
  { key: 'modules.crm', path: '/crm', enabled: false },
  { key: 'modules.reports', path: '/reports', enabled: false },
  { key: 'modules.admin', path: '/admin', enabled: true },
] as const;
```

- [ ] **Step 2: Add the route in App.tsx**

Add the import:

```typescript
import { ProductsPage } from '../modules/inventory/ProductsPage';
```

Add the route alongside the existing ones:

```tsx
<Route element={<AppShell />}>
  <Route index element={<Dashboard />} />
  <Route path="admin" element={<AdminPage />} />
  <Route path="inventory" element={<ProductsPage />} />
</Route>
```

- [ ] **Step 3: Verify typecheck, lint, and tests**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: zero errors, all tests passing.

- [ ] **Step 4: Commit**

```bash
git add src/app/AppShell.tsx src/app/App.tsx
git commit -m "Enable the Inventory route"
```

---

### Task 9: Extend the e2e test

**Files:**

- Modify: `tests/e2e/app.spec.ts`

- [ ] **Step 1: Add a product-creation round trip**

Add at the end of the `'bootstraps the first admin account and reaches the shell'` test, right before `await app.close();`:

```typescript
await window.getByRole('link', { name: 'Inventory' }).click();
await window.getByRole('button', { name: 'Add product' }).click();
await window.getByLabel('Name').fill('E2E Test Widget');
await window.getByLabel('SKU').fill(`E2E-${Date.now()}`);
await window.getByLabel('Category').fill('Test');
await window.getByLabel('Price (RWF)').fill('1500');
await window.getByLabel('Stock quantity').fill('5');
await window.getByRole('button', { name: 'Add product' }).click();
await expect(window.getByText('E2E Test Widget')).toBeVisible({ timeout: 10_000 });
```

A per-run unique SKU (`E2E-${Date.now()}`) keeps this robust to repeated
local runs the same way the Backup/Notification assertions needed
`.first()` — a fresh SKU can never collide with a prior run's row, so no
`.first()` is needed here specifically, but the product NAME `'E2E Test
Widget'` will repeat across local re-runs; `getByText` without `.first()`
would fail the same way the backup filename assertion did. Use
`.first()` on that final assertion too:

```typescript
await expect(window.getByText('E2E Test Widget').first()).toBeVisible({ timeout: 10_000 });
```

- [ ] **Step 2: Rebuild and run the e2e tests**

Run: `pnpm build && pnpm exec playwright test`
Expected: both tests PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/app.spec.ts
git commit -m "Extend e2e test to verify a product can be added"
```

---

### Task 10: Documentation, final verification, and merge

**Files:**

- Modify: `docs/architecture.md`

- [ ] **Step 1: Add an Inventory Foundation section to docs/architecture.md, before the IPC contract section**

Cover: why this is scoped as Inventory's foundational slice rather than
folded into POS (POS Sale Flow depends on it, not the other way around),
the `Product` model's soft-delete (`isActive`) rationale mirroring
`User.isActive`, why `category` is a plain string rather than a lookup
table (YAGNI until a second consumer needs to query by it), and that
`products.ts` returns `ProductResult` directly from its mutating functions
(rather than throwing) so IPC handlers stay pure passthroughs, matching
`backup-manager.ts`'s convention rather than `auth.ts`'s throw-based one.

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
git push -u origin feature/inventory-foundation
```

- [ ] **Step 4: Verify CI passes on GitHub, dispatch an independent code-review subagent, address findings**

Follow the same pattern as every prior sub-project: once CI is green,
dispatch a fresh subagent to review the full branch diff against this plan
and the design spec before merging.

- [ ] **Step 5: Merge via the finishing-a-development-branch skill once CI is green and review findings are addressed**
