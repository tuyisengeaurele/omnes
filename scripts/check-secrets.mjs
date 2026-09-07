#!/usr/bin/env node
/**
 * Staged-content secret scan.
 *
 * Runs as a pre-commit hook and in CI. Reads the *staged* blob rather than the
 * working tree, so `git add` followed by an edit cannot smuggle content past it.
 *
 * The remote is public. A credential that reaches a commit is compromised even
 * if the commit is amended away a minute later, because the object stays
 * reachable through the reflog and through any fork or clone taken in between.
 * Rotating is then the only real remedy, so the cheapest place to stop it is here.
 *
 * Escape hatch: append `omnes:allow-secret` in a comment on the same line for a
 * value that is genuinely not a credential. Deliberate, greppable, reviewable.
 */

import { execFileSync } from 'node:child_process';
import process from 'node:process';

const ALLOW_MARKER = 'omnes:allow-secret';

/** Files that never contain hand-written credentials but do contain hash-like noise. */
const SKIPPED_PATHS = [
  /(^|\/)package-lock\.json$/,
  /(^|\/)pnpm-lock\.yaml$/,
  /(^|\/)yarn\.lock$/,
  /\.min\.(js|css)$/,
  /\.map$/,
  /\.(png|jpe?g|gif|webp|avif|ico|svg|pdf|woff2?|ttf|eot|zip|gz|tar|mp4|webm)$/i,
];

/** Filenames that must never be committed at all, whatever they contain. */
const FORBIDDEN_FILENAMES = [
  { pattern: /(^|\/)\.env$/, reason: 'environment file' },
  { pattern: /(^|\/)\.env\.(?!example$)[^/]+$/, reason: 'environment file' },
  { pattern: /\.(pem|key|p12|pfx|jks|keystore)$/i, reason: 'key material' },
  { pattern: /(^|\/)id_(rsa|dsa|ecdsa|ed25519)$/, reason: 'ssh private key' },
  { pattern: /(^|\/)\.npmrc$/, reason: 'may contain a registry auth token' },
  { pattern: /(^|\/)service-account.*\.json$/i, reason: 'cloud service account key' },
];

/**
 * Values that look like credentials but are placeholders. Checked against the
 * captured value of a generic assignment match, case-insensitively.
 */
const PLACEHOLDER = new RegExp(
  [
    '^\\s*$',
    '^<.*>$', // <your-key-here>
    '^\\{\\{.*\\}\\}$', // {{TEMPLATE}}
    '^\\$\\{.*\\}$', // ${ENV_VAR}
    '^\\$[A-Z_][A-Z0-9_]*$', // $ENV_VAR
    '(example|placeholder|changeme|change[-_]me|replace[-_]?me|your[-_])',
    '(dummy|sample|fixture|fake|mock|test|todo|tbd|redacted)',
    '^(secret|password|passwd|token|apikey|api[-_]key|null|undefined|none|xxx+|\\*+|\\.+)$',
    '^(localhost|postgres|postgresql|admin|root|user)$',
  ].join('|'),
  'i'
);

/**
 * High-confidence provider credential formats.
 *
 * An entry may set `placeholderGroup` to the index of a capture holding the
 * secret portion. When it is set, a match whose captured value is an obvious
 * placeholder is not reported, which is what lets `.env.example` carry a
 * syntactically valid connection string without tripping the scan.
 */
const PROVIDER_PATTERNS = [
  { name: 'private key block', re: /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/ },
  { name: 'AWS access key id', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { name: 'Slack token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'Stripe secret key', re: /\bsk_(?:live|test)_[0-9A-Za-z]{16,}\b/ },
  { name: 'Twilio account sid', re: /\bAC[0-9a-f]{32}\b/ },
  { name: 'SendGrid key', re: /\bSG\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/ },
  { name: 'signed JWT', re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
  {
    name: 'connection string with inline password',
    re: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^:@\s/]+:([^@\s/]{4,})@/,
    placeholderGroup: 1,
  },
];

/**
 * Generic `key = "value"` assignments. The value must be a quoted literal, which
 * keeps `password: z.string()` and `token = await mint()` out of the results,
 * since those are code rather than credentials.
 */
const GENERIC_ASSIGNMENT =
  /\b(password|passwd|pwd|secret|api[-_]?key|apikey|access[-_]?token|auth[-_]?token|client[-_]?secret|private[-_]?key|encryption[-_]?key|jwt[-_]?secret|session[-_]?secret|db[-_]?pass\w*)\b\s*[:=]\s*(['"`])([^'"`\n]{8,})\2/gi;

/** Values that a credential-shaped key name can legitimately hold. */
const NON_SECRET_VALUE = /^(?:\d+|true|false|on|off|yes|no)$/i;

/** `KEY=value` in dotenv-style files, where quoting is optional. */
const DOTENV_ASSIGNMENT =
  /^\s*(?:export\s+)?([A-Z0-9_]*(?:PASSWORD|SECRET|TOKEN|API_?KEY|PRIVATE_?KEY|CREDENTIAL)[A-Z0-9_]*)\s*=\s*(.+?)\s*$/gim;

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function stagedFiles() {
  const out = git(['diff', '--cached', '--name-only', '--diff-filter=ACM']);
  return out.split('\n').filter(Boolean);
}

function stagedContent(file) {
  try {
    const buf = execFileSync('git', ['show', `:${file}`], { maxBuffer: 64 * 1024 * 1024 });
    if (buf.includes(0)) return null; // binary
    return buf.toString('utf8');
  } catch {
    return null;
  }
}

function unquote(value) {
  const trimmed = value.trim();
  const quoted = /^(['"])(.*)\1$/.exec(trimmed);
  return quoted ? quoted[2] : trimmed;
}

function scanFile(file, content) {
  const findings = [];
  const lines = content.split(/\r?\n/);

  const record = (lineNo, kind, detail) => {
    const line = lines[lineNo - 1] ?? '';
    if (line.includes(ALLOW_MARKER)) return;
    findings.push({ file, line: lineNo, kind, detail });
  };

  lines.forEach((line, i) => {
    for (const { name, re, placeholderGroup } of PROVIDER_PATTERNS) {
      const match = re.exec(line);
      if (!match) continue;
      if (placeholderGroup && PLACEHOLDER.test(match[placeholderGroup] ?? '')) continue;
      record(i + 1, name, 'matches a known credential format');
    }
  });

  for (const match of content.matchAll(GENERIC_ASSIGNMENT)) {
    const value = match[3];
    if (PLACEHOLDER.test(value)) continue;
    const lineNo = content.slice(0, match.index).split('\n').length;
    record(lineNo, `assignment to \`${match[1]}\``, `literal value of ${value.length} chars`);
  }

  if (/\.env|\.envrc$/.test(file) || file.endsWith('.env.example')) {
    for (const match of content.matchAll(DOTENV_ASSIGNMENT)) {
      const value = unquote(match[2]);
      if (PLACEHOLDER.test(value)) continue;
      // A TTL, a port, a retry count or a feature flag is not a credential,
      // even though the key it sits under contains the word TOKEN or SECRET.
      if (NON_SECRET_VALUE.test(value)) continue;
      // Nothing shorter than this is a usable secret.
      if (value.length < 8) continue;
      const lineNo = content.slice(0, match.index).split('\n').length;
      record(
        lineNo,
        `${match[1]} has a real-looking value`,
        'use a placeholder in committed files'
      );
    }
  }

  return findings;
}

function main() {
  const files = stagedFiles();
  const findings = [];

  for (const file of files) {
    for (const { pattern, reason } of FORBIDDEN_FILENAMES) {
      if (pattern.test(file)) {
        findings.push({
          file,
          line: 0,
          kind: `forbidden file (${reason})`,
          detail: 'must not be committed',
        });
      }
    }

    if (SKIPPED_PATHS.some((re) => re.test(file))) continue;

    const content = stagedContent(file);
    if (content === null) continue;
    findings.push(...scanFile(file, content));
  }

  if (findings.length === 0) {
    console.log(`secret scan: clean (${files.length} staged file${files.length === 1 ? '' : 's'})`);
    return 0;
  }

  console.error('\nsecret scan: commit blocked\n');
  for (const f of findings) {
    const where = f.line > 0 ? `${f.file}:${f.line}` : f.file;
    console.error(`  ${where}\n    ${f.kind}: ${f.detail}`);
  }
  console.error(
    [
      '',
      'Remove the value and load it from the environment instead.',
      `If this is genuinely not a credential, add a \`${ALLOW_MARKER}\` comment on that line.`,
      '',
      'If a real secret already reached a commit, rotate it. Rewriting history is',
      'not sufficient once the object has been pushed to a public remote.',
      '',
    ].join('\n')
  );
  return 1;
}

process.exit(main());
