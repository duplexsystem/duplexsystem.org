#!/usr/bin/env node
import { readFile, writeFile, rename, readdir, access } from 'node:fs/promises';
import { join } from 'node:path';
import { hash8, hashedName } from './lib/hash.mjs';
import { rewritePages } from './lib/html.mjs';
import { isMain } from './lib/main.mjs';

const HASHED = /\.[0-9a-f]{8}\.[a-z]+$/;
const SELF_PATH = /\/\^\(\.\*\\\/\)pagefind\.js\.\*\$\//g;
const SELF_PATH_HASHED = '/^(.*\\/)pagefind(?:\\.[0-9a-f]{8})?\\.js.*$/';

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function rewrite(file, pattern, replacement) {
  const src = await readFile(file, 'utf8');
  const out = src.replace(pattern, replacement);
  if (out === src) {
    throw new Error(`hash_pagefind: no ${pattern} in ${file}; Pagefind's loader changed`);
  }
  await writeFile(file, out);
}

async function hashFile(dir, name) {
  const name2 = hashedName(name, await readFile(join(dir, name)));
  await rename(join(dir, name), join(dir, name2));
  return name2;
}

export default async function hashPagefind(distDir = 'dist') {
  const dir = join(distDir, 'pagefind');
  if ((await readdir(dir).catch(() => [])).some((f) => HASHED.test(f))) {
    console.log('pagefind: already hashed');
    return new Map();
  }
  if (!(await exists(join(dir, 'pagefind.js')))) {
    throw new Error(`hash_pagefind: ${dir}/pagefind.js missing. Did pagefind run?`);
  }
  const loaders = [join(dir, 'pagefind.js'), join(dir, 'pagefind-worker.js')];
  const names = new Map();

  const entry = await hashFile(dir, 'pagefind-entry.json');
  names.set('pagefind-entry.json', entry);
  for (const f of loaders) await rewrite(f, /pagefind-entry\.json/g, entry);

  const wasm = (await readdir(dir)).filter((f) => /^wasm\.[\w-]+\.pagefind$/.test(f)).sort();
  if (wasm.length === 0) throw new Error(`hash_pagefind: no wasm.*.pagefind in ${dir}`);
  const wasmHash = hash8(Buffer.concat(await Promise.all(wasm.map((f) => readFile(join(dir, f))))));
  for (const f of wasm) {
    const to = f.replace(/\.pagefind$/, `.${wasmHash}.pagefind`);
    await rename(join(dir, f), join(dir, to));
    names.set(f, to);
  }
  for (const f of loaders) {
    await rewrite(f, /(wasm\.\$\{[^}]+\}\.)pagefind/g, `$1${wasmHash}.pagefind`);
  }

  const worker = await hashFile(dir, 'pagefind-worker.js');
  names.set('pagefind-worker.js', worker);
  await rewrite(loaders[0], /pagefind-worker\.js/g, worker);

  await rewrite(loaders[0], SELF_PATH, SELF_PATH_HASHED);
  const core = await hashFile(dir, 'pagefind.js');
  names.set('pagefind.js', core);
  await rewrite(join(dir, 'pagefind-component-ui.js'), /(?<![\w-])pagefind\.js/g, core);

  for (const f of ['pagefind-component-ui.js', 'pagefind-component-ui.css']) {
    names.set(f, await hashFile(dir, f));
  }

  const urls = [...names].map(([from, to]) => [`/pagefind/${from}`, `/pagefind/${to}`]);
  const pages = await rewritePages(distDir, (html) =>
    urls.reduce((out, [from, to]) => out.split(`${from}"`).join(`${to}"`), html),
  );

  console.log(`pagefind: ${names.size} runtime file(s) hashed, ${pages} page(s) rewritten`);
  return names;
}

if (isMain(import.meta.url)) {
  await hashPagefind(process.argv[2]);
}
