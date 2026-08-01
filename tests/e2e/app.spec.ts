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

  await app.close();
});
