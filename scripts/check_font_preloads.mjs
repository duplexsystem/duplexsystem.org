#!/usr/bin/env node
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import {
  GateError,
  REPO_ROOT,
  attrsOf,
  htmlPages,
  openTags,
  report,
  runMain,
} from './lib/gates.mjs';

const GENERATED_REL = 'src/assets/fonts/generated';
const GENERATED = join(REPO_ROOT, GENERATED_REL);
const SPLIT_FACES = '/_astro/fonts/';

const sha = (buf) => createHash('sha256').update(buf).digest('hex');

export function preloadedFonts(html) {
  const hrefs = [];
  for (const { name, text } of openTags(html)) {
    if (name !== 'link') continue;
    const attrs = attrsOf(text);
    if (attrs.get('rel') === 'preload' && attrs.get('as') === 'font' && attrs.get('href')) {
      hrefs.push(attrs.get('href'));
    }
  }
  return hrefs;
}

async function main(distDir = 'dist') {
  const core = new Set();
  for (const name of await readdir(GENERATED)) {
    if (name.endsWith('-core.woff2')) core.add(sha(await readFile(join(GENERATED, name))));
  }
  if (core.size === 0) {
    throw new GateError(`no -core.woff2 files in ${GENERATED_REL}; run subset_fonts.py first`);
  }

  const failures = [];
  const verdicts = new Map();
  for await (const { path, html } of htmlPages(distDir)) {
    const hrefs = preloadedFonts(html).filter((h) => h.startsWith(SPLIT_FACES));
    if (hrefs.length === 0) failures.push(`${path}: preloads no font`);
    for (const href of hrefs) {
      if (!verdicts.has(href)) {
        let ok = false;
        try {
          ok = core.has(sha(await readFile(join(distDir, href))));
        } catch {
        }
        verdicts.set(href, ok);
      }
      if (!verdicts.get(href)) failures.push(`${path}: preloads non-core font ${href}`);
    }
  }

  report(
    'font preloads must be -core subsets',
    failures,
    `ok: font preloads are all core subsets (${verdicts.size} distinct)`,
    20,
  );
}

await runMain(import.meta.url, main);
