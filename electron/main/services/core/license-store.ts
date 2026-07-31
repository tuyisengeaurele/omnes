import { app } from 'electron';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import log from 'electron-log/main';
import { getDevelopmentLicense, verifyLicense } from './license';
import type { LicenseInfo } from '@shared/ipc';

let cachedLicense: LicenseInfo | null = null;

function loadLicenseFromDisk(): LicenseInfo {
  const licensePath = path.join(app.getPath('userData'), 'license.omneslicense');

  let fileContents: string;
  try {
    fileContents = readFileSync(licensePath, 'utf8');
  } catch {
    return getDevelopmentLicense();
  }

  try {
    return verifyLicense(fileContents);
  } catch (error) {
    log.warn('License file present but invalid, falling back to development license', error);
    return getDevelopmentLicense();
  }
}

export function getActiveLicense(): LicenseInfo {
  cachedLicense ??= loadLicenseFromDisk();
  return cachedLicense;
}
