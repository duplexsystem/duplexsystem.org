#!/usr/bin/env node
// Publish the site's 88x31 at /.well-known/button, per the draft spec at
// https://codeberg.org/LunarEclipse/well-known-button.
// Static hosts cannot content-negotiate: both representations are written as
// real files and nginx maps the extensionless endpoint onto one.
// Runs after optimize_assets: the sha256 must match the bytes served.
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { walk } from './lib/fswalk.mjs';
import yaml from 'js-yaml';

const SITE = 'https://duplexsystem.org';
const PLACEHOLDER = '__BUTTON_DATA_URI__';
const SHA_PLACEHOLDER = '__BUTTON_SHA256__';

export async function writeWellKnownButton(distDir = 'dist') {
  const { buttons = [] } = yaml.load(await readFile('src/data/buttons.yaml', 'utf8')) ?? {};
  const own = buttons.find((b) => b.own);
  if (!own) {
    throw new Error('well-known-button: buttons.yaml has no button marked `own: true`');
  }

  const source = join(distDir, own.img.replace(/^\//, ''));
  const bytes = await readFile(source);

  const dir = join(distDir, '.well-known');
  await mkdir(dir, { recursive: true });

  // No image copy: nginx rewrites the endpoint onto own.img, so the bytes
  // exist once in dist and the endpoint cannot drift.

  const entry = {
    id: own.name,
    uri: `${SITE}${own.img}`,
    alt: own.alt ?? own.name,
    link: SITE,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
  await writeFile(join(dir, 'button.json'), `${JSON.stringify([entry], null, 2)}\n`);

  const base64 = bytes.toString('base64');
  let filled = 0;
  for await (const page of walk(distDir)) {
    if (!page.endsWith('.html')) continue;
    const html = await readFile(page, 'utf8');
    if (!html.includes(PLACEHOLDER) && !html.includes(SHA_PLACEHOLDER)) continue;
    await writeFile(
      page,
      html.split(PLACEHOLDER).join(base64).split(SHA_PLACEHOLDER).join(entry.sha256),
    );
    filled++;
  }

  console.log(
    `well-known button: ${entry.id} (${bytes.length} B, sha256 ${entry.sha256.slice(0, 12)}…)` +
      `, snippet filled on ${filled} page(s)`,
  );
  return entry;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await writeWellKnownButton(process.argv[2] ?? 'dist');
}
