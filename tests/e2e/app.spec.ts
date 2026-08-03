import path from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import { prisma } from '../../electron/main/services/core/database';

test.beforeEach(async () => {
  await prisma.user.deleteMany();
});

test.afterAll(async () => {
  await prisma.$disconnect();
});

test('shows the first-admin bootstrap screen on a fresh database', async () => {
  const app = await electron.launch({
    args: [path.resolve(process.cwd(), 'out/main/index.js')],
  });

  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');

  await expect(window).toHaveTitle('OMNES');
  await expect(window.getByLabel('Username')).toBeVisible({ timeout: 10_000 });
  await expect(window.getByRole('button', { name: 'Create account' })).toBeVisible();

  await app.close();
});

test('bootstraps the first admin account and reaches the shell', async () => {
  const app = await electron.launch({
    args: [path.resolve(process.cwd(), 'out/main/index.js')],
  });

  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');

  await window.getByLabel('Username').fill('e2e-admin');
  await window.getByLabel('Password', { exact: true }).fill('e2e-test-password-123');
  await window.getByLabel('Confirm password').fill('e2e-test-password-123');
  await window.getByRole('button', { name: 'Create account' }).click();

  // Only reachable once authenticated — this is where the version badge,
  // database status, and sidebar (all previously asserted directly on
  // launch, before this sub-project added an auth gate in front of them)
  // now get checked, after a real login.
  await expect(window.getByText('Core')).toBeVisible({ timeout: 10_000 });
  await expect(window.getByText(/^v\d+\.\d+\.\d+$/)).toBeVisible();
  await expect(window.getByText('Database connected')).toBeVisible({ timeout: 10_000 });
  await expect(window.getByText('License: DEVELOPMENT')).toBeVisible();
  await expect(window.getByText('e2e-admin')).toBeVisible();

  await window.getByRole('link', { name: 'Administration' }).click();
  await window.getByRole('button', { name: 'Back up now' }).click();
  // .first(): a single CI run always produces exactly one match, but a
  // local re-run of this suite reuses the same userData directory (nothing
  // clears backup history between runs, only Users), so this stays robust
  // without needing a manual reset before every local run.
  await expect(window.getByText(/^omnes-backup-/).first()).toBeVisible({ timeout: 30_000 });

  // Proves the full notification path end-to-end: performManualBackup()'s
  // success branch really calls notify(), the IPC push really reaches the
  // renderer live (no reload happened), and the bell reflects it.
  await expect(window.getByLabel('Notifications')).toBeVisible();
  await window.getByLabel('Notifications').click();
  await expect(window.getByText('Backup created').first()).toBeVisible();
  await window.getByLabel('Notifications').click(); // close the panel again

  // Restore requires typing the literal word RESTORE before it's enabled —
  // proves both the confirmation gate and that an ADMIN session (the only
  // role createFirstAdmin ever creates) can actually complete a restore.
  await window.getByRole('button', { name: 'Restore', exact: true }).first().click();
  const confirmButton = window.getByRole('button', { name: 'Confirm restore' });
  await expect(confirmButton).toBeDisabled();
  await window.getByPlaceholder('RESTORE').fill('RESTORE');
  await expect(confirmButton).toBeEnabled();
  await confirmButton.click();
  await expect(window.getByText('Restore completed')).toBeVisible({ timeout: 30_000 });

  // A per-run-unique username, so this assertion never needs .first() the
  // way the product-name-based ones elsewhere in this file do.
  const cashierUsername = `e2e-cashier-${Date.now()}`;
  await window.getByRole('button', { name: 'Add user' }).click();
  await window.getByLabel('Username').fill(cashierUsername);
  await window.getByLabel('Password').fill('cashier-password-123');
  await window.getByRole('button', { name: 'Add user' }).click();
  await expect(window.getByText(cashierUsername)).toBeVisible({ timeout: 10_000 });

  // The SKU (not the product name) is what's actually unique per run —
  // "E2E Test Widget" repeats across every local re-run of this suite, so
  // every locator below that needs to identify *this run's* product uses
  // the SKU, never the name alone (a `.first()` on the name would pick
  // whichever accumulated row Postgres happens to return first for a tied
  // `ORDER BY name`, not necessarily this run's).
  const sku = `E2E-${Date.now()}`;

  await window.getByRole('link', { name: 'Inventory' }).click();
  await window.getByRole('button', { name: 'Add product' }).click();
  await window.getByLabel('Name').fill('E2E Test Widget');
  await window.getByLabel('SKU').fill(sku);
  await window.getByLabel('Category').fill('Test');
  await window.getByLabel('Price (RWF)').fill('1500');
  await window.getByLabel('Stock quantity').fill('5');
  await window.getByRole('button', { name: 'Add product' }).click();
  await expect(window.getByText(sku)).toBeVisible({ timeout: 10_000 });

  await window.getByRole('link', { name: 'Point of Sale' }).click();
  // Searching by the unique SKU (ProductSearch matches on name/SKU/barcode)
  // returns exactly this run's product, no ambiguity.
  await window.getByPlaceholder('Search products by name, SKU, or barcode').fill(sku);
  await window.getByText(sku).click();
  await window.getByRole('button', { name: 'Cash' }).click();
  await window.getByLabel('Amount tendered').fill('2000');
  await window.getByRole('button', { name: 'Checkout' }).click();
  await expect(window.getByRole('button', { name: 'Print' })).toBeVisible({ timeout: 10_000 });
  await expect(window.getByText(/E2E Test Widget/)).toBeVisible();
  await window.getByRole('button', { name: 'Close' }).click();

  await window.getByRole('link', { name: 'Inventory' }).click();
  // Stock was 5, minus the 1 just sold in POS — identifying the row by the
  // unique SKU (not the shared name) so this checks this run's actual row.
  await expect(window.locator('tr', { hasText: sku })).toContainText('4');

  await app.close();
});
