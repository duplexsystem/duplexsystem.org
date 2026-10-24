#!/usr/bin/env node
import { readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { findFiles, walk } from './lib/fswalk.mjs';
import { hashedName } from './lib/hash.mjs';
import { isMain } from './lib/main.mjs';

const HASHED = /\.[0-9a-f]{8}\.js$/;

export function rewriteScriptRefs(source, mapping) {
  let out = source;
  for (const [from, to] of mapping) {
    out = out.replace(
      new RegExp(`(["'(=])${from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=["')\\s>])`, 'g'),
      `$1${to}`,
    );
  }
  return out;
}

export default async function hashScripts(distDir = 'dist') {
  const files = (await findFiles(join(distDir, 'js'), /\.js$/).catch(() => [])).filter(
    (path) => !HASHED.test(path),
  );
  const mapping = new Map();
  for (const path of files) {
    const name = hashedName(path, await readFile(path));
    await rename(path, join(join(distDir, 'js'), name));
    mapping.set(`/js/${path.slice(path.lastIndexOf('/') + 1)}`, `/js/${name}`);
  }
  if (mapping.size === 0) {
    console.log('scripts: nothing to hash');
    return { hashed: 0 };
  }

  let pages = 0;
  for await (const path of walk(distDir)) {
    if (!/\.(html|css|xml|txt|json)$/i.test(path)) continue;
    const src = await readFile(path, 'utf8');
    const out = rewriteScriptRefs(src, mapping);
    if (out !== src) {
      await writeFile(path, out);
      pages += 1;
    }
  }
  console.log(`scripts: ${mapping.size} hashed across ${pages} file(s)`);
  return { hashed: mapping.size };
}

if (isMain(import.meta.url)) {
  await hashScripts(process.argv[2]);
}
