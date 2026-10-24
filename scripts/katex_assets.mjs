#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { findFiles } from './lib/fswalk.mjs';
import { REPO_ROOT } from './lib/gates.mjs';
import { siteFontChars } from './lib/font-usage-site.mjs';
import { hash8 } from './lib/hash.mjs';
import { swap } from './lib/html.mjs';
import { isMain } from './lib/main.mjs';

const KATEX = 'node_modules/katex/dist';
const SUBSETS = join(REPO_ROOT, 'src/assets/fonts/generated/katex');
const LOCK = join(REPO_ROOT, 'src/assets/fonts/chars.json');
const INLINE_MAX = 2048;
const FULL = /^(1|true|yes)$/i.test(process.env.INCLUDE_DRAFTS?.trim() ?? '');

const KATEX_LINK = /<link\b[^>]*\bhref="\/_astro\/katex\.[0-9a-f]{8}\.css"[^>]*>/;

export function linkKatexCss(html, cssName) {
  const old = KATEX_LINK.exec(html)?.[0];
  if (old) return swap(html, old, old.replace(/katex\.[0-9a-f]{8}\.css/, cssName));
  return swap(html, '</head>', `<link rel="stylesheet" href="/_astro/${cssName}" />\n</head>`);
}

const faceStem = (body) => /url\(fonts\/([^)]+)\.woff2\)/.exec(body)?.[1] ?? null;

export default async function katexAssets(distDir = 'dist') {
  const mathPages = [];
  for (const path of await findFiles(distDir, /\.html$/)) {
    if ((await readFile(path, 'utf8')).includes('class="katex')) mathPages.push(path);
  }
  if (mathPages.length === 0) {
    console.log('katex: no math in this build, nothing shipped');
    return { pages: 0, faces: 0 };
  }

  const css = await readFile(join(KATEX, 'katex.min.css'), 'utf8');
  const lock = FULL
    ? Object.fromEntries(
        [...(await siteFontChars(distDir, { extraCss: [css] })).faces]
          .filter(([face, chars]) => face.startsWith('KaTeX_') && chars.size)
          .map(([face]) => [face, '']),
      )
    : existsSync(LOCK)
      ? JSON.parse(await readFile(LOCK, 'utf8'))
      : {};
  await mkdir(join(distDir, '_astro'), { recursive: true });
  const urls = new Map();
  let shipped = 0;
  let inlined = 0;
  for (const [, body] of css.matchAll(/@font-face\{([^}]*)\}/g)) {
    const stem = faceStem(body);
    if (!stem || !(stem in lock)) continue;
    const file = FULL ? join(KATEX, 'fonts', `${stem}.woff2`) : join(SUBSETS, `${stem}.woff2`);
    if (!existsSync(file)) {
      throw new Error(
        `katex: ${stem} is in chars.json but not subset; run scripts/subset_fonts.py`,
      );
    }
    const bytes = await readFile(file);
    shipped += bytes.length;
    if (bytes.length <= INLINE_MAX) {
      urls.set(stem, `data:font/woff2;base64,${bytes.toString('base64')}`);
      inlined++;
    } else {
      const name = `${stem}.${hash8(bytes)}.woff2`;
      await writeFile(join(distDir, '_astro', name), bytes);
      urls.set(stem, `/_astro/${name}`);
    }
  }

  const trimmed = css.replace(/@font-face\{([^}]*)\}/g, (block, body) => {
    const url = urls.get(faceStem(body));
    if (!url) return '';
    return `@font-face{${body.replace(/src:[^;]+/, `src:url(${url}) format("woff2")`)}}`;
  });
  const cssName = `katex.${hash8(Buffer.from(trimmed))}.css`;
  await writeFile(join(distDir, '_astro', cssName), trimmed);
  for (const path of mathPages) {
    const html = await readFile(path, 'utf8');
    await writeFile(path, linkKatexCss(html, cssName));
  }
  console.log(
    `katex: ${urls.size} face(s), ${(shipped / 1024).toFixed(1)} kB (${inlined} inlined), ` +
      `linked on ${mathPages.length} page(s)`,
  );
  return { pages: mathPages.length, faces: urls.size };
}

if (isMain(import.meta.url)) {
  await katexAssets(process.argv[2]);
}
