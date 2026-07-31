// @vitest-environment node
import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  getDevelopmentLicense,
  isFeatureEnabled,
  verifyLicense,
} from '../../electron/main/services/core/license';
import type { LicenseInfo } from '../../shared/ipc';

// Must match canonicalize() in electron/main/services/core/license.ts —
// these tests sign their own throwaway keypair, they never touch the real
// embedded production key or keys/.
function canonicalize(payload: unknown): string {
  return JSON.stringify(payload, Object.keys(payload as Record<string, unknown>).sort());
}

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const testPublicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();

function signTestLicense(payload: Record<string, unknown>, signingKey = privateKey): string {
  const payloadBytes = Buffer.from(canonicalize(payload));
  const signature = sign(null, payloadBytes, signingKey).toString('base64');
  return JSON.stringify({ payload, signature });
}

const BASE_PAYLOAD = {
  licenseId: 'test-license-1',
  customerName: 'Test Shop',
  tier: 'BASE',
  addons: [],
  issuedAt: new Date().toISOString(),
  expiresAt: null,
};

describe('verifyLicense', () => {
  it('verifies a validly signed license', () => {
    const fileContents = signTestLicense(BASE_PAYLOAD);

    const result = verifyLicense(fileContents, testPublicKeyPem);

    expect(result.licenseId).toBe('test-license-1');
    expect(result.tier).toBe('BASE');
    expect(result.customerName).toBe('Test Shop');
  });

  it('rejects a tampered payload', () => {
    const fileContents = signTestLicense(BASE_PAYLOAD);
    const tampered = JSON.parse(fileContents);
    tampered.payload.addons = ['crm'];

    expect(() => verifyLicense(JSON.stringify(tampered), testPublicKeyPem)).toThrow(
      'signature is invalid',
    );
  });

  it('rejects a license signed with a different key', () => {
    const otherKeypair = generateKeyPairSync('ed25519');
    const fileContents = signTestLicense(BASE_PAYLOAD, otherKeypair.privateKey);

    expect(() => verifyLicense(fileContents, testPublicKeyPem)).toThrow('signature is invalid');
  });

  it('rejects an expired license', () => {
    const expiredPayload = { ...BASE_PAYLOAD, expiresAt: new Date(0).toISOString() };
    const fileContents = signTestLicense(expiredPayload);

    expect(() => verifyLicense(fileContents, testPublicKeyPem)).toThrow('expired');
  });

  it('rejects malformed JSON', () => {
    expect(() => verifyLicense('not json', testPublicKeyPem)).toThrow('not valid JSON');
  });

  it('rejects a file missing payload or signature', () => {
    expect(() =>
      verifyLicense(JSON.stringify({ payload: BASE_PAYLOAD }), testPublicKeyPem),
    ).toThrow('missing payload or signature');
  });
});

describe('isFeatureEnabled', () => {
  it('the development license has every feature enabled', () => {
    expect(isFeatureEnabled('crm', getDevelopmentLicense())).toBe(true);
    expect(isFeatureEnabled('multi_warehouse', getDevelopmentLicense())).toBe(true);
  });

  it('a base license has base features but not add-ons', () => {
    const license: LicenseInfo = {
      licenseId: 'x',
      customerName: null,
      tier: 'BASE',
      addons: [],
      issuedAt: '',
      expiresAt: null,
    };

    expect(isFeatureEnabled('pos', license)).toBe(true);
    expect(isFeatureEnabled('crm', license)).toBe(false);
  });

  it('a base license with an add-on has that add-on enabled', () => {
    const license: LicenseInfo = {
      licenseId: 'x',
      customerName: null,
      tier: 'BASE',
      addons: ['crm'],
      issuedAt: '',
      expiresAt: null,
    };

    expect(isFeatureEnabled('crm', license)).toBe(true);
    expect(isFeatureEnabled('loyalty', license)).toBe(false);
  });
});
