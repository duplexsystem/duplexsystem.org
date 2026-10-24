#!/usr/bin/env node
import { execFile, execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { gunzipSync } from 'node:zlib';
import { cached } from './lib/cache.mjs';
import { findFiles } from './lib/fswalk.mjs';
import { sha256 } from './lib/hash.mjs';
import { isMain } from './lib/main.mjs';
import { mapPool } from './lib/pool.mjs';

const run = promisify(execFile);
const CACHE = '.cache/zopfli';

const GZIPPED = /\.(pagefind|pf_fragment|pf_index|pf_meta|pf_filter)$/;

export function isGzip(bytes) {
  return bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

async function zopfli(inner, raw, iterations, path) {
  return cached(CACHE, `${sha256(inner, String(iterations))}.gz`, async () => {
    await writeFile(raw, inner);
    const { stdout } = await run('zopfli', [`--i${iterations}`, '-c', raw], {
      encoding: 'buffer',
      maxBuffer: 64 * 1024 * 1024,
    });
    if (!gunzipSync(stdout).equals(inner)) {
      throw new Error(`recompress_pagefind: zopfli changed the contents of ${path}`);
    }
    return stdout;
  });
}

export default async function recompressPagefind(distDir = 'dist', { iterations = 15 } = {}) {
  try {
    execFileSync('zopfli', ['-h'], { stdio: 'ignore' });
  } catch (e) {
    if (e.code === 'ENOENT') {
      console.warn('recompress_pagefind: zopfli not found, skipped');
      return null;
    }
  }
  const work = await mkdtemp(join(tmpdir(), 'recompress-'));
  let files = 0;
  let saved = 0;
  try {
    const paths = await findFiles(join(distDir, 'pagefind'), GZIPPED);
    await mapPool(paths, async (path, i) => {
      const before = await readFile(path);
      if (!isGzip(before)) return;
      const inner = gunzipSync(before);
      const after = await zopfli(inner, join(work, String(i)), iterations, path);
      if (after.length < before.length) {
        await writeFile(path, after);
        files++;
        saved += before.length - after.length;
      }
    });
  } finally {
    await rm(work, { recursive: true, force: true });
  }
  console.log(`recompress_pagefind: ${files} files, ${(saved / 1024).toFixed(1)} kB saved`);
  return { files, saved };
}

if (isMain(import.meta.url)) {
  await recompressPagefind(process.argv[2]);
}
