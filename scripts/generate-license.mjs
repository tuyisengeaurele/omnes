#!/usr/bin/env node
import { generateKeyPairSync, sign, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const KEYS_DIR = path.resolve(import.meta.dirname, '../keys');
const PRIVATE_KEY_PATH = path.join(KEYS_DIR, 'license-private-key.pem');
const PUBLIC_KEY_PATH = path.join(KEYS_DIR, 'license-public-key.pem');

// Must match LicenseTier and Feature in shared/ipc.ts exactly. Signing a
// license with a typo'd tier/addon here would either produce a license
// isFeatureEnabled() can't correctly evaluate, or — for a typo'd tier —
// accidentally grant unconditional access the same way DEVELOPMENT does,
// since isFeatureEnabled() treats anything that isn't DEVELOPMENT as BASE.
const VALID_TIERS = ['DEVELOPMENT', 'BASE'];
const VALID_FEATURES = [
  'pos',
  'inventory',
  'receipts',
  'reports_basic',
  'administration',
  'mobile_money',
  'crm',
  'loyalty',
  'store_credit',
  'reports_advanced',
  'multi_warehouse',
];

// Must match the canonicalize() in electron/main/services/core/license.ts
// exactly, or signatures produced here will fail to verify there.
function canonicalize(payload) {
  return JSON.stringify(payload, Object.keys(payload).sort());
}

function generateKeypair(force) {
  if (existsSync(PRIVATE_KEY_PATH) && !force) {
    console.error(
      `A keypair already exists at ${PRIVATE_KEY_PATH}. Pass --force to overwrite it ` +
        '(this invalidates every license already signed with it).',
    );
    process.exit(1);
  }

  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  mkdirSync(KEYS_DIR, { recursive: true });
  writeFileSync(PRIVATE_KEY_PATH, privateKey.export({ type: 'pkcs8', format: 'pem' }));
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  writeFileSync(PUBLIC_KEY_PATH, publicKeyPem);

  console.log(`Keypair written to ${KEYS_DIR}`);
  console.log('\nPaste this into electron/main/services/core/license-public-key.ts:\n');
  console.log(publicKeyPem);
}

function signLicense({ tier, addons, customerName, expiresAt, output }) {
  if (!existsSync(PRIVATE_KEY_PATH)) {
    console.error(`No private key found at ${PRIVATE_KEY_PATH}. Run "keygen" first.`);
    process.exit(1);
  }

  if (!VALID_TIERS.includes(tier)) {
    console.error(`Invalid --tier "${tier}". Must be one of: ${VALID_TIERS.join(', ')}`);
    process.exit(1);
  }

  const invalidAddons = addons.filter((addon) => !VALID_FEATURES.includes(addon));
  if (invalidAddons.length > 0) {
    console.error(
      `Invalid --addons value(s): ${invalidAddons.join(', ')}. Must be from: ${VALID_FEATURES.join(', ')}`,
    );
    process.exit(1);
  }

  if (expiresAt && Number.isNaN(new Date(expiresAt).getTime())) {
    console.error(`Invalid --expires "${expiresAt}". Must be a valid ISO date string.`);
    process.exit(1);
  }

  const privateKeyPem = readFileSync(PRIVATE_KEY_PATH, 'utf8');

  const payload = {
    licenseId: randomUUID(),
    customerName: customerName ?? null,
    tier,
    addons,
    issuedAt: new Date().toISOString(),
    expiresAt: expiresAt ?? null,
  };

  const payloadBytes = Buffer.from(canonicalize(payload));
  const signature = sign(null, payloadBytes, privateKeyPem).toString('base64');

  writeFileSync(output, JSON.stringify({ payload, signature }, null, 2));
  console.log(`License written to ${output}`);
}

function getArg(args, name, fallback) {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : args[index + 1];
}

const [, , command, ...args] = process.argv;

if (command === 'keygen') {
  generateKeypair(args.includes('--force'));
} else if (command === 'sign') {
  signLicense({
    tier: getArg(args, 'tier', 'BASE'),
    addons: (getArg(args, 'addons', '') || '').split(',').filter(Boolean),
    customerName: getArg(args, 'customer', null),
    expiresAt: getArg(args, 'expires', null),
    output: getArg(args, 'output', 'license.omneslicense'),
  });
} else {
  console.log('Usage:');
  console.log('  node scripts/generate-license.mjs keygen [--force]');
  console.log(
    '  node scripts/generate-license.mjs sign --tier BASE [--addons crm,reports_advanced] ' +
      '[--customer "Acme Shop"] [--expires 2027-01-01T00:00:00.000Z] [--output license.omneslicense]',
  );
  process.exit(1);
}
