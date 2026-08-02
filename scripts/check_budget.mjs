#!/usr/bin/env node
import { readFile, stat, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { walk } from './lib/fswalk.mjs';

// Sized to catch an un-subset font sneaking in, not to police markup bytes.
const BUDGETS = {
  default: 400_000,
  '/search/index.html': 410_000,
};

function budgetFor(relPath) {
  return BUDGETS[`/${relPath}`] ?? BUDGETS.default;
}

export function referencedAssets(html) {
  const urls = new Set();
  // Only tags a browser fetches while rendering. Not <a href>: /licenses/
  // links straight to /pagefind/*.js. Not content=: og:image is crawler-only.
  for (const m of html.matchAll(
    /<(?:link|script|img)\b[^>]*\b(?:href|src)="(\/[^"]+\.(?:css|js|woff2|avif|webp|png|jpg|svg))"/g,
  )) {
    urls.add(m[1]);
  }
  for (const m of html.matchAll(
    /url\(["']?(\/[^"')]+\.(?:css|js|woff2|avif|webp|png|jpg|svg))["']?\)/g,
  )) {
    urls.add(m[1]);
  }
  return [...urls];
}

async function sizeOf(distDir, url) {
  try {
    return (await stat(join(distDir, url))).size;
  } catch {
    return 0;
  }
}

export async function pageWeight(distDir, html) {
  let total = Buffer.byteLength(html);
  const seen = new Set();
  const addOnce = async (url) => {
    if (seen.has(url)) return 0;
    seen.add(url);
    return sizeOf(distDir, url);
  };
  for (const url of referencedAssets(html)) {
    total += await addOnce(url);
    if (url.endsWith('.css')) {
      try {
        const css = await readFile(join(distDir, url), 'utf8');
        for (const inner of referencedAssets(css)) total += await addOnce(inner);
      } catch {
        /* stylesheet missing: addOnce already counted it as 0 */
      }
    }
  }
  return total;
}

async function main(distDir = 'dist') {
  const FORBIDDEN = /\.(avif|jpe?g|gif)$/i;
  const offenders = [];
  for await (const path of walk(distDir)) {
    if (FORBIDDEN.test(path)) offenders.push(path);
  }
  if (offenders.length > 0) {
    console.error('FAIL: forbidden image formats in dist (expected webp/png/svg only):');
    for (const o of offenders) console.error(`  ${o}`);
    process.exit(1);
  }

  const failures = [];

  for await (const path of walk(distDir)) {
    if (!path.endsWith('.html')) continue;
    const html = await readFile(path, 'utf8');
    const total = await pageWeight(distDir, html);

    const budget = budgetFor(relative(distDir, path).split(sep).join('/'));
    if (total > budget) {
      failures.push(
        `${path}: ${(total / 1024).toFixed(1)} kB exceeds ${(budget / 1024).toFixed(0)} kB`,
      );
    }
  }

  if (failures.length) {
    console.error('FAIL: page weight budget exceeded');
    for (const f of failures) console.error(`  ${f}`);
    process.exit(1);
  }
  console.log('ok: all pages within weight budget');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main(process.argv[2]);
}
