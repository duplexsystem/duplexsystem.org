#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { GateError, REPO_ROOT, report, runMain } from './lib/gates.mjs';
import { siteFontChars } from './lib/font-usage-site.mjs';

const LOCK = join(REPO_ROOT, 'src/assets/fonts/chars.json');

export function unlocked(chars, lock) {
  const out = new Map();
  for (const [face, set] of chars) {
    const have = lock[face] ?? '';
    const missing = [...set].filter((ch) => !have.includes(ch));
    if (missing.length) out.set(face, missing);
  }
  return out;
}

const hex = (ch) => `U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`;

async function main(distDir = 'dist') {
  let lock;
  try {
    lock = JSON.parse(await readFile(LOCK, 'utf8'));
  } catch {
    throw new GateError('no src/assets/fonts/chars.json; run `npm run fonts:lock`');
  }
  const { perPage } = await siteFontChars(distDir);
  const failures = [];
  for (const { path, chars } of perPage) {
    for (const [face, missing] of unlocked(chars, lock)) {
      failures.push(`${path}: ${face} needs ${missing.map((ch) => `${hex(ch)} ${ch}`).join(', ')}`);
    }
  }
  report(
    "a page needs characters its fonts' core subsets lack (run `npm run fonts:lock`, then commit src/assets/fonts/chars.json)",
    failures,
    `ok: every page's text is in its fonts' core subsets (${perPage.length} pages)`,
    20,
  );
}

await runMain(import.meta.url, main);
