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
  await expect(window.getByText('e2e-admin')).toBeVisible();

  await app.close();
});
