import { createPublicKey, verify } from 'node:crypto';
import { LICENSE_PUBLIC_KEY_PEM } from './license-public-key';
import type { Feature, LicenseInfo, LicenseTier } from '@shared/ipc';

interface LicensePayload {
  licenseId: string;
  customerName: string | null;
  tier: LicenseTier;
  addons: Feature[];
  issuedAt: string;
  expiresAt: string | null;
}

interface LicenseFile {
  payload: LicensePayload;
  signature: string;
}

// Must match canonicalize() in scripts/generate-license.mjs exactly, or
// signatures produced by that script will fail to verify here.
function canonicalize(payload: LicensePayload): string {
  return JSON.stringify(payload, Object.keys(payload).sort());
}

export function verifyLicense(
  fileContents: string,
  publicKeyPem: string = LICENSE_PUBLIC_KEY_PEM,
): LicenseInfo {
  let parsed: LicenseFile;
  try {
    parsed = JSON.parse(fileContents) as LicenseFile;
  } catch {
    throw new Error('License file is not valid JSON');
  }

  if (!parsed.payload || !parsed.signature) {
    throw new Error('License file is missing payload or signature');
  }

  const publicKey = createPublicKey(publicKeyPem);
  const payloadBytes = Buffer.from(canonicalize(parsed.payload));
  const signatureBytes = Buffer.from(parsed.signature, 'base64');

  const isValid = verify(null, payloadBytes, publicKey, signatureBytes);
  if (!isValid) {
    throw new Error('License signature is invalid');
  }

  if (parsed.payload.expiresAt && new Date(parsed.payload.expiresAt).getTime() < Date.now()) {
    throw new Error('License has expired');
  }

  return {
    licenseId: parsed.payload.licenseId,
    customerName: parsed.payload.customerName,
    tier: parsed.payload.tier,
    addons: parsed.payload.addons,
    issuedAt: parsed.payload.issuedAt,
    expiresAt: parsed.payload.expiresAt,
  };
}

const DEVELOPMENT_LICENSE: LicenseInfo = {
  licenseId: 'development',
  customerName: null,
  tier: 'DEVELOPMENT',
  addons: [],
  issuedAt: new Date(0).toISOString(),
  expiresAt: null,
};

export function getDevelopmentLicense(): LicenseInfo {
  return DEVELOPMENT_LICENSE;
}

const BASE_FEATURES: Feature[] = [
  'pos',
  'inventory',
  'receipts',
  'reports_basic',
  'administration',
  'mobile_money',
];

export function isFeatureEnabled(feature: Feature, license: LicenseInfo): boolean {
  if (license.tier === 'DEVELOPMENT') {
    return true;
  }
  return BASE_FEATURES.includes(feature) || license.addons.includes(feature);
}
