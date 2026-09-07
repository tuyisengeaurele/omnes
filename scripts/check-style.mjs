#!/usr/bin/env node
/**
 * Blocks typographic characters that mark text as machine-generated.
 *
 * Runs over staged file content in the pre-commit hook, over the message in the
 * commit-msg hook, and over the whole tree in CI. Pass `--all` to scan every
 * tracked file, or `--message <path>` to scan a commit message file.
 *
 * This bans a specific list of characters rather than all non-ASCII, because
 * product copy ships in Kinyarwanda and French and needs its accented letters.
 *
 * Escape hatch: put `omnes:allow-style` in a comment on the same line.
 */

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import process from 'node:process';

const ALLOW_MARKER = 'omnes:allow-style';

/**
 * Characters are written as code points rather than literals so this file does
 * not trip its own rule. Keep it that way.
 */
const BANNED = [
  [
    0x2014,
    'em dash',
    'rewrite the sentence, because swapping in a hyphen still reads as generated',
  ],
  [0x2013, 'en dash', 'use a plain hyphen, or the word "to" for a range'],
  [0x2018, 'curly opening quote', 'use a straight apostrophe'],
  [0x2019, 'curly apostrophe', 'use a straight apostrophe'],
  [0x201c, 'curly opening double quote', 'use a straight double quote'],
  [0x201d, 'curly closing double quote', 'use a straight double quote'],
  [0x2026, 'ellipsis character', 'use three periods'],
  [0x00a0, 'non-breaking space', 'use a normal space'],
  [0x2212, 'unicode minus', 'use a hyphen'],
  [0x00b7, 'middot', 'use a comma, a period, or a list'],
  [0x2022, 'bullet character', 'use a markdown list'],
].map(([code, name, fix]) => [String.fromCodePoint(code), name, fix]);

const BANNED_BY_CHAR = new Map(BANNED.map(([c, name, fix]) => [c, { name, fix }]));
const BANNED_RE = new RegExp(`[${BANNED.map(([c]) => c).join('')}]`, 'g');

/** The requirements spec is the client's own document and is not ours to restyle. */
const EXEMPT = [
  /^docs\/requirements-spec\.md$/,
  /(^|\/)package-lock\.json$/,
  /(^|\/)node_modules\//,
];

const BINARY_EXT = /\.(png|jpe?g|gif|webp|avif|ico|svg|pdf|woff2?|ttf|eot|zip|gz|tar|mp4|webm)$/i;

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function findingsIn(label, text) {
  const out = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (line.includes(ALLOW_MARKER)) return;
    for (const match of line.matchAll(BANNED_RE)) {
      const info = BANNED_BY_CHAR.get(match[0]);
      out.push({
        label,
        line: i + 1,
        col: match.index + 1,
        name: info.name,
        fix: info.fix,
        excerpt: line.trim().slice(0, 90),
      });
    }
  });
  return out;
}

function stagedText(file) {
  try {
    const buf = execFileSync('git', ['show', `:${file}`], { maxBuffer: 64 * 1024 * 1024 });
    if (buf.includes(0)) return null;
    return buf.toString('utf8');
  } catch {
    return null;
  }
}

function main(argv) {
  const messagePath = argv.includes('--message') ? argv[argv.indexOf('--message') + 1] : null;
  const scanAll = argv.includes('--all');
  const findings = [];

  if (messagePath) {
    // Strip the commented template git appends to the message buffer.
    const raw = readFileSync(messagePath, 'utf8')
      .split(/\r?\n/)
      .filter((l) => !l.startsWith('#'))
      .join('\n');
    findings.push(...findingsIn('commit message', raw));
  } else {
    const files = scanAll
      ? git(['ls-files']).split('\n').filter(Boolean)
      : git(['diff', '--cached', '--name-only', '--diff-filter=ACM']).split('\n').filter(Boolean);

    for (const file of files) {
      if (EXEMPT.some((re) => re.test(file)) || BINARY_EXT.test(file)) continue;
      let text;
      if (scanAll) {
        try {
          text = readFileSync(file, 'utf8');
        } catch {
          continue;
        }
      } else {
        text = stagedText(file);
        if (text === null) continue;
      }
      findings.push(...findingsIn(file, text));
    }
  }

  if (findings.length === 0) {
    console.log('style scan: clean');
    return 0;
  }

  console.error('\nstyle scan: blocked\n');
  for (const f of findings) {
    console.error(`  ${f.label}:${f.line}:${f.col}  ${f.name}`);
    console.error(`    ${f.excerpt}`);
    console.error(`    fix: ${f.fix}\n`);
  }
  console.error(`Add \`${ALLOW_MARKER}\` on the line if the character is genuinely required.\n`);
  return 1;
}

process.exit(main(process.argv.slice(2)));
