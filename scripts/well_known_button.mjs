#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { load as loadYaml } from 'js-yaml';
import { sha256 } from './lib/hash.mjs';
import { rewritePages } from './lib/html.mjs';
import { isMain } from './lib/main.mjs';
import { SITE } from './lib/site.mjs';

const PLACEHOLDER = '__BUTTON_DATA_URI__';
const SHA_PLACEHOLDER = '__BUTTON_SHA256__';

export default async function writeWellKnownButton(distDir = 'dist') {
  const { buttons = [] } = loadYaml(await readFile('src/data/buttons.yaml', 'utf8')) ?? {};
  const own = buttons.find((b) => b.own);
  if (!own) {
    throw new Error('well-known-button: buttons.yaml has no button marked `own: true`');
  }

  const source = join(distDir, own.img.replace(/^\//, ''));
  const bytes = await readFile(source);

  const dir = join(distDir, '.well-known');
  await mkdir(dir, { recursive: true });

  const entry = {
    id: own.name,
    uri: `${SITE}${own.img}`,
    alt: own.alt ?? own.name,
    link: SITE,
    sha256: sha256(bytes),
  };
  await writeFile(join(dir, 'button.json'), `${JSON.stringify([entry], null, 2)}\n`);

  const base64 = bytes.toString('base64');
  const filled = await rewritePages(distDir, (html) =>
    html.split(PLACEHOLDER).join(base64).split(SHA_PLACEHOLDER).join(entry.sha256),
  );

  console.log(
    `well-known button: ${entry.id} (${bytes.length} B, sha256 ${entry.sha256.slice(0, 12)}…)` +
      `, snippet filled on ${filled} page(s)`,
  );
  return entry;
}

if (isMain(import.meta.url)) {
  await writeWellKnownButton(process.argv[2]);
}
