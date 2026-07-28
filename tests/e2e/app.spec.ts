import path from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';

test('launches the shell and resolves the app version and database status over IPC', async () => {
  const app = await electron.launch({
    args: [path.resolve(process.cwd(), 'out/main/index.js')],
  });

  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');

  await expect(window).toHaveTitle('OMNES');
  await expect(window.getByText('Core')).toBeVisible();
  await expect(window.getByText(/^v\d+\.\d+\.\d+$/)).toBeVisible();
  await expect(window.getByText(/^Database (connected|offline)$/)).toBeVisible({
    timeout: 10_000,
  });

  await app.close();
});
