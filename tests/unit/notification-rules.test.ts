// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  hasLicenseExpired,
  isLicenseExpiringSoon,
} from '../../electron/main/services/core/notification-rules';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('hasLicenseExpired', () => {
  it('a license with no expiry never expires', () => {
    expect(hasLicenseExpired(null)).toBe(false);
  });

  it('a past date has expired', () => {
    expect(hasLicenseExpired(new Date(Date.now() - DAY_MS).toISOString())).toBe(true);
  });

  it('a future date has not expired', () => {
    expect(hasLicenseExpired(new Date(Date.now() + DAY_MS).toISOString())).toBe(false);
  });
});

describe('isLicenseExpiringSoon', () => {
  it('a license with no expiry is never expiring soon', () => {
    expect(isLicenseExpiringSoon(null, 14)).toBe(false);
  });

  it('an already-expired license is not "expiring soon"', () => {
    expect(isLicenseExpiringSoon(new Date(Date.now() - DAY_MS).toISOString(), 14)).toBe(false);
  });

  it('a date well within the threshold is expiring soon', () => {
    expect(isLicenseExpiringSoon(new Date(Date.now() + 10 * DAY_MS).toISOString(), 14)).toBe(true);
  });

  it('a date well beyond the threshold is not expiring soon', () => {
    expect(isLicenseExpiringSoon(new Date(Date.now() + 20 * DAY_MS).toISOString(), 14)).toBe(false);
  });

  it('is expiring soon just under the threshold', () => {
    const justUnder = new Date(Date.now() + 14 * DAY_MS - 1000).toISOString();
    expect(isLicenseExpiringSoon(justUnder, 14)).toBe(true);
  });

  it('is not expiring soon just over the threshold', () => {
    const justOver = new Date(Date.now() + 14 * DAY_MS + 60_000).toISOString();
    expect(isLicenseExpiringSoon(justOver, 14)).toBe(false);
  });
});
