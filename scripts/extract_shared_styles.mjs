#!/usr/bin/env node
import { readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { findFiles } from './lib/fswalk.mjs';
import { hash8 } from './lib/hash.mjs';
import { swap } from './lib/html.mjs';
import { isMain } from './lib/main.mjs';

export default async function extractSharedStyles(distDir = 'dist') {
  const pages = await findFiles(distDir, /\.html$/);
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

  const bundle = /<link rel="stylesheet" href="(\/_astro\/[^"]+\.css)">/.exec(firstHtml)?.[1];
  const onEveryPage = bundle && [...htmls.values()].every((h) => h.includes(bundle));

  let name;
  let link = '';
  if (onEveryPage) {
    const merged = `${await readFile(join(distDir, bundle), 'utf8')}\n${css}`;
    name = `style.${hash8(merged)}.css`;
    await writeFile(join(distDir, '_astro', name), merged);
    await rm(join(distDir, bundle), { force: true });
  } else {
    name = `fonts.${hash8(css)}.css`;
    await writeFile(join(distDir, '_astro', name), css);
    link = `<link rel="stylesheet" href="/_astro/${name}">`;
  }

  let saved = 0;
  for (const [p, h] of htmls) {
    let out = h;
    for (const [i, b] of shared.entries()) {
      out = swap(out, b, i === 0 ? link : '');
    }
    if (onEveryPage) out = out.split(bundle).join(`/_astro/${name}`);
    saved += h.length - out.length;
    await writeFile(p, out);
  }

  console.log(
    `shared styles: ${shared.length} font block(s) ${onEveryPage ? 'folded into' : '->'} ` +
      `_astro/${name} (${(css.length / 1024).toFixed(1)} kB), ` +
      `${(saved / 1024).toFixed(1)} kB removed across ${pages.length} page(s)`,
  );
  return { moved: shared.length, folded: Boolean(onEveryPage) };
}

if (isMain(import.meta.url)) {
  await extractSharedStyles(process.argv[2]);
}
