#!/usr/bin/env node
import { readFile, writeFile, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { load as loadYaml } from 'js-yaml';
import { findFiles, posixRel, walk } from './lib/fswalk.mjs';
import { hashedName } from './lib/hash.mjs';
import { isMain } from './lib/main.mjs';

const BUTTONS = '/buttons/';

async function ownButton() {
  const data = loadYaml(await readFile('src/data/buttons.yaml', 'utf8'));
  return data?.buttons?.find((b) => b.own)?.img ?? null;
}

export default async function hashButtons(distDir = 'dist') {
  const own = await ownButton();
  const root = join(distDir, 'buttons');
  const files = (await findFiles(root, /\.(png|webp|gif|jpg|svg)$/i).catch(() => [])).filter(
    (path) => !/\.[0-9a-f]{8}\.[a-z]+$/i.test(path),
  );

  const mapping = new Map();
  for (const path of files) {
    const dir = dirname(path);
    const url = `${BUTTONS}${posixRel(root, path)}`;
    if (url === own) continue;
    const name = hashedName(path, await readFile(path));
    await rename(path, join(dir, name));
    mapping.set(url, `${BUTTONS}${posixRel(root, join(dir, name))}`);
  }

  if (mapping.size === 0) {
    console.log('buttons: nothing to hash');
    return { hashed: 0 };
  }

  let pages = 0;
  for await (const path of walk(distDir)) {
    if (!/\.(html|css|xml|txt|json)$/i.test(path)) continue;
    const src = await readFile(path, 'utf8');
    let out = src;
    for (const [from, to] of mapping) out = out.split(from).join(to);
    if (out !== src) {
      await writeFile(path, out);
      pages += 1;
    }
  }

  console.log(
    `buttons: ${mapping.size} hashed across ${pages} file(s)` + (own ? `, ${own} left stable` : ''),
  );
  return { hashed: mapping.size };
}

if (isMain(import.meta.url)) {
  await hashButtons(process.argv[2]);
}
