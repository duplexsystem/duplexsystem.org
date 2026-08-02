#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const STEPS = [
  'localize_embed_media',
  'embed_titles',
  'add_blurhash',
  'extract_inline_scripts',
  'katex_assets',
  'extract_shared_styles',
  'optimize_assets',
  'well_known_button',
  'precompress',
];

const GATES = [
  'check_budget',
  'check_search',
  'check_links',
  'check_js',
  'check_licenses',
  'check_frames',
  'check_embeds',
  'check_spelling',
];

const distDir = process.argv[2] ?? 'dist';
const withGates = process.argv.includes('--gates');
// Drafts are content: spelling is worth checking before a post is published,
// not only at the gate that blocks publishing.
const spellingOnly = !withGates && process.argv.includes('--spelling');
const selected = withGates ? GATES : spellingOnly ? ['check_spelling'] : [];

for (const name of [...STEPS, ...selected]) {
  const r = spawnSync('node', [`scripts/${name}.mjs`, distDir], { stdio: 'inherit' });
  if (r.status !== 0) {
    console.error(`postprocess: ${name} failed (exit ${r.status})`);
    process.exit(r.status ?? 1);
  }
}
