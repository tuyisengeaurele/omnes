// @vitest-environment node
// This file talks to the real local PostgreSQL database (via the same
// Prisma client the app uses) and deletes all User rows before and after
// every test to get a known-empty starting state. It assumes exclusive
// access to the User table while running — don't run it concurrently with
// anything else that touches User rows in the same database.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../electron/main/services/core/database';
import {
  createFirstAdmin,
  getSession,
  hasUsers,
  login,
  logout,
} from '../../electron/main/services/core/auth';

const TEST_USERNAME = '__test_admin__';
const TEST_PASSWORD = 'correct-horse-battery-staple';

async function clearUsers(): Promise<void> {
  await prisma.user.deleteMany();
}

describe('auth', () => {
  beforeEach(async () => {
    await clearUsers();
  });

  afterEach(async () => {
    await clearUsers();
  });

  it('reports no users on an empty table', async () => {
    expect(await hasUsers()).toBe(false);
  });

  it('creates the first admin and starts a session', async () => {
    const session = await createFirstAdmin(TEST_USERNAME, TEST_PASSWORD);

    expect(session.username).toBe(TEST_USERNAME);
    expect(session.role).toBe('ADMIN');
    expect(session.isLocked).toBe(false);
    expect(await hasUsers()).toBe(true);
  });

  it('refuses to create a second first-admin once one exists', async () => {
    await createFirstAdmin(TEST_USERNAME, TEST_PASSWORD);

    await expect(createFirstAdmin('someone-else', TEST_PASSWORD)).rejects.toThrow();
  });

  it('only allows one of two concurrent createFirstAdmin calls to succeed', async () => {
    const results = await Promise.allSettled([
      createFirstAdmin('concurrent-one', TEST_PASSWORD),
      createFirstAdmin('concurrent-two', TEST_PASSWORD),
    ]);

    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(await prisma.user.count()).toBe(1);
  });

  it('rejects a username shorter than the minimum length', async () => {
    await expect(createFirstAdmin('ab', TEST_PASSWORD)).rejects.toThrow(
      'Username must be at least 3 characters',
    );
  });

  it('rejects a password shorter than the minimum length', async () => {
    await expect(createFirstAdmin(TEST_USERNAME, 'short')).rejects.toThrow(
      'Password must be at least 8 characters',
    );
  });

  it('logs in with correct credentials', async () => {
    await createFirstAdmin(TEST_USERNAME, TEST_PASSWORD);
    await logout();

    const session = await login(TEST_USERNAME, TEST_PASSWORD);

    expect(session.username).toBe(TEST_USERNAME);
    expect(getSession()?.username).toBe(TEST_USERNAME);
  });

  it('rejects an incorrect password with a generic error', async () => {
    await createFirstAdmin(TEST_USERNAME, TEST_PASSWORD);
    await logout();

    await expect(login(TEST_USERNAME, 'wrong-password')).rejects.toThrow(
      'Invalid username or password',
    );
  });

  it('rejects a username that does not exist with the same generic error', async () => {
    await expect(login('nobody', TEST_PASSWORD)).rejects.toThrow('Invalid username or password');
  });

  it('clears the session on logout', async () => {
    await createFirstAdmin(TEST_USERNAME, TEST_PASSWORD);
    await logout();

    expect(getSession()).toBeNull();
  });
});
