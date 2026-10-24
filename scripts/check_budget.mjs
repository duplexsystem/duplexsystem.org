#!/usr/bin/env node
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { walk } from './lib/fswalk.mjs';
import { attrsOf, htmlPages, openTags, report, runMain } from './lib/gates.mjs';

const BUDGETS = {
  default: 400_000,
  '/search/index.html': 410_000,
};

function budgetFor(relPath) {
  return BUDGETS[`/${relPath}`] ?? BUDGETS.default;
}

const ASSET_URL = /^\/.+\.(?:css|js|woff2|avif|webp|png|jpg|svg)$/;
const FETCHING_TAGS = new Set(['link', 'script', 'img', 'source', 'video']);
const CSS_URL = /url\(["']?(\/[^"')]+\.(?:css|js|woff2|avif|webp|png|jpg|svg))["']?\)/g;

export function referencedAssets(html) {
  const urls = new Set();
  for (const { name, text } of openTags(html)) {
    if (!FETCHING_TAGS.has(name)) continue;
    const attrs = attrsOf(text);
    const candidates = [attrs.get('href'), attrs.get('src'), attrs.get('poster')];
    for (const set of [attrs.get('srcset'), attrs.get('imagesrcset')]) {
      if (set) candidates.push(...set.split(',').map((c) => c.trim().split(/\s+/)[0]));
    }
    for (const url of candidates) if (url && ASSET_URL.test(url)) urls.add(url);
  }
  for (const m of html.matchAll(CSS_URL)) urls.add(m[1]);
  return [...urls];
}

function parseUnicodeRange(spec) {
  return spec.split(',').map((part) => {
    const t = part.trim().replace(/^U\+/i, '');
    if (t.includes('?')) {
      return [parseInt(t.replace(/\?/g, '0'), 16), parseInt(t.replace(/\?/g, 'F'), 16)];
    }
    const [lo, hi = lo] = t.split('-');
    return [parseInt(lo, 16), parseInt(hi, 16)];
  });
}

export function unusedRangedFonts(css, pageText) {
  const unused = new Set();
  for (const [face] of css.matchAll(/@font-face\s*\{[^}]*\}/g)) {
    const range = face.match(/unicode-range\s*:\s*([^;}]+)/)?.[1];
    if (!range) continue;
    const spans = parseUnicodeRange(range);
    let used = false;
    for (const ch of pageText) {
      const cp = ch.codePointAt(0);
      if (spans.some(([lo, hi]) => cp >= lo && cp <= hi)) {
        used = true;
        break;
      }
    }
    if (used) continue;
    for (const url of referencedAssets(face)) unused.add(url);
  }
  return unused;
}

async function sentSize(file) {
  for (const f of [`${file}.br`, file]) {
    try {
      return (await stat(f)).size;
    } catch {
    }
  }
  return 0;
}

const sizeOf = (distDir, url) => sentSize(join(distDir, url));

export async function pageWeight(distDir, html, pagePath) {
  let total = pagePath ? await sentSize(pagePath) : Buffer.byteLength(html);
  const seen = new Set();
  const addOnce = async (url) => {
    if (seen.has(url)) return 0;
    seen.add(url);
    return sizeOf(distDir, url);
  };
  const inlineUnused = unusedRangedFonts(html, html);
  for (const url of referencedAssets(html)) {
    if (inlineUnused.has(url)) continue;
    total += await addOnce(url);
    if (url.endsWith('.css')) {
      try {
        const css = await readFile(join(distDir, url), 'utf8');
        const unused = unusedRangedFonts(css, html);
        for (const inner of referencedAssets(css)) {
          if (!unused.has(inner)) total += await addOnce(inner);
        }
      } catch {
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
  if (offenders.length) {
    report('forbidden image formats in dist (expected webp/png/svg only):', offenders, '');
    return;
  }

  const failures = [];
  for await (const { rel, path, html } of htmlPages(distDir)) {
    const total = await pageWeight(distDir, html, path);
    const budget = budgetFor(rel);
    if (total > budget) {
      failures.push(
        `${path}: ${(total / 1024).toFixed(1)} kB exceeds ${(budget / 1024).toFixed(0)} kB`,
      );
    }
  }
  report('page weight budget exceeded', failures, 'ok: all pages within weight budget');
}

await runMain(import.meta.url, main);
