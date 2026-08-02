#!/usr/bin/env node
import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { promisify } from 'node:util';
import zlib from 'node:zlib';
import { walk } from './lib/fswalk.mjs';

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
]);
const MIN_BYTES = 1024;
const MIN_RATIO = 0.9; // must be at least 10% smaller to be worth an extra file

export function shouldCompress(path) {
  return COMPRESSIBLE.has(extname(path).toLowerCase());
}

export function isWorthKeeping(original, compressed) {
  return compressed <= original * MIN_RATIO;
}

export async function precompress(distDir) {
  let files = 0;
  let saved = 0;

  for await (const path of walk(distDir)) {
    if (!shouldCompress(path)) continue;
    const { size } = await stat(path);
    if (size < MIN_BYTES) continue;

    const bytes = await readFile(path);

    const br = await brotli(bytes, {
      params: {
        [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
        [zlib.constants.BROTLI_PARAM_SIZE_HINT]: size,
      },
    });
    if (isWorthKeeping(size, br.length)) {
      await writeFile(`${path}.br`, br);
      files++;
      saved += size - br.length;
    }

    const gz = await gzip(bytes, { level: 9 });
    if (isWorthKeeping(size, gz.length)) {
      await writeFile(`${path}.gz`, gz);
      files++;
    }
  }

  return { files, saved };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { files, saved } = await precompress(process.argv[2] ?? 'dist');
  console.log(
    `precompressed: ${files} sibling files, ${(saved / 1024).toFixed(1)} kB saved on brotli`,
  );
}
