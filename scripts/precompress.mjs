#!/usr/bin/env node
import { readFile, rm, writeFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { promisify } from 'node:util';
import zlib from 'node:zlib';
import { findFiles } from './lib/fswalk.mjs';
import { isMain } from './lib/main.mjs';
import { mapPool } from './lib/pool.mjs';

const brotli = promisify(zlib.brotliCompress);
const gzip = promisify(zlib.gzip);

const COMPRESSIBLE = new Set([
  '.html',
  '.css',
  '.js',
  '.svg',
  '.json',
  '.xml',
  '.txt',
  '.webmanifest',
  '.wasm',
]);

export function shouldCompress(path) {
  return COMPRESSIBLE.has(extname(path).toLowerCase());
}

export function isWorthKeeping(original, compressed) {
  return compressed < original;
}

async function keepOrDrop(path, original, bytes) {
  if (isWorthKeeping(original, bytes.length)) {
    await writeFile(path, bytes);
    return true;
  }
  await rm(path, { force: true });
  return false;
}

export default async function precompress(distDir = 'dist') {
  let files = 0;
  let saved = 0;

  await mapPool(
    await findFiles(distDir, /./).then((all) => all.filter(shouldCompress)),
    async (path) => {
      const bytes = await readFile(path);
      const size = bytes.length;

      const br = await brotli(bytes, {
        params: {
          [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
          [zlib.constants.BROTLI_PARAM_SIZE_HINT]: size,
        },
      });
      if (await keepOrDrop(`${path}.br`, size, br)) {
        files++;
        saved += size - br.length;
      }

      if (await keepOrDrop(`${path}.gz`, size, await gzip(bytes, { level: 9 }))) files++;
    },
  );

  console.log(
    `precompressed: ${files} sibling files, ${(saved / 1024).toFixed(1)} kB saved on brotli`,
  );
  return { files, saved };
}

if (isMain(import.meta.url)) {
  await precompress(process.argv[2]);
}
