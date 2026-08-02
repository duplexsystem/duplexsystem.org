#!/usr/bin/env node
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { walk } from './lib/fswalk.mjs';

export async function extractSharedStyles(distDir = 'dist') {
  const pages = [];
  for await (const p of walk(distDir)) {
    if (p.endsWith('.html')) pages.push(p);
  }
  if (pages.length === 0) {
    console.log('shared styles: no pages, skipped');
    return { moved: 0 };
  }

  const firstHtml = await readFile(pages[0], 'utf8');
  const fontBlocks = [...firstHtml.matchAll(/<style[^>]*>[\s\S]*?<\/style>/g)]
    .map((m) => m[0])
    .filter((b) => b.includes('@font-face'));
  if (fontBlocks.length === 0) {
    console.log('shared styles: no font styles found, skipped');
    return { moved: 0 };
  }

  const htmls = new Map([[pages[0], firstHtml]]);
  let shared = fontBlocks;
  for (const p of pages.slice(1)) {
    const h = await readFile(p, 'utf8');
    htmls.set(p, h);
    shared = shared.filter((b) => h.includes(b));
    if (shared.length === 0) break;
  }
  if (shared.length === 0) {
    console.log('shared styles: font styles differ between pages, nothing moved');
    return { moved: 0 };
  }

  const css = shared
    .map((b) => b.replace(/^<style[^>]*>/, '').replace(/<\/style>$/, ''))
    .join('\n');
  const name = `fonts.${createHash('sha256').update(css).digest('hex').slice(0, 8)}.css`;
  await writeFile(join(distDir, '_astro', name), css);

  const link = `<link rel="stylesheet" href="/_astro/${name}">`;
  let saved = 0;
  for (const [p, h] of htmls) {
    let out = h;
    for (const [i, b] of shared.entries()) {
      out = out.replace(b, i === 0 ? link : '');
    }
    saved += h.length - out.length;
    await writeFile(p, out);
  }

  console.log(
    `shared styles: ${shared.length} font block(s) -> _astro/${name} ` +
      `(${(css.length / 1024).toFixed(1)} kB), ${(saved / 1024).toFixed(1)} kB removed across ${pages.length} page(s)`,
  );
  return { moved: shared.length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await extractSharedStyles(process.argv[2]);
}
