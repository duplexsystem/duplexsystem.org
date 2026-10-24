#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from './lib/gates.mjs';
import { siteFontChars } from './lib/font-usage-site.mjs';

const LOCK = join(REPO_ROOT, 'src/assets/fonts/chars.json');
const distDir = process.argv[2] ?? 'dist-lock';
const { faces } = await siteFontChars(distDir);
const out = Object.fromEntries(
  [...faces]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([face, set]) => [face, [...set].sort().join('')]),
);
writeFileSync(LOCK, `${JSON.stringify(out, null, 2)}\n`);
for (const [face, chars] of Object.entries(out))
  console.log(`  ${face.padEnd(26)} ${[...chars].length} characters`);
console.log(`wrote ${LOCK.replace(REPO_ROOT, '')}`);
