#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const STEPS = [
  'localize_embed_media',
  'embed_titles',
  'add_placeholders',
  'extract_inline_scripts',
  'katex_assets',
  'extract_shared_styles',
  'optimize_assets',
  'well_known_button',
  'hash_buttons',
  'hash_scripts',
  'make_jxl',
  'recompress_pagefind',
  'hash_pagefind',
  'security_txt',
  'precompress',
];

const GATES = [
  'check_budget',
  'check_jxl',
  'check_font_preloads',
  'check_font_chars',
  'check_search',
  'check_links',
  'check_js',
  'check_licenses',
  'check_frames',
  'check_embeds',
  'check_remote',
  'check_spelling',
];

const here = dirname(fileURLToPath(import.meta.url));
const distDir = process.argv[2] ?? 'dist';
const withGates = process.argv.includes('--gates');
const spellingOnly = !withGates && process.argv.includes('--spelling');
const selected = withGates ? GATES : spellingOnly ? ['check_spelling'] : [];

const fail = (name, why, status = 1) => {
  console.error(`postprocess: ${name} failed (${why})`);
  process.exit(status);
};

for (const name of STEPS) {
  try {
    await (await import(`./${name}.mjs`)).default(distDir);
  } catch (e) {
    console.error(e);
    fail(name, e.message);
  }
}

for (const name of selected) {
  const r = spawnSync('node', [join(here, `${name}.mjs`), distDir], { stdio: 'inherit' });
  if (r.status !== 0) fail(name, r.error?.message ?? `exit ${r.status ?? r.signal}`, r.status ?? 1);
}
