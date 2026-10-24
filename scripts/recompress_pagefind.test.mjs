import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import recompressPagefind, { isGzip } from './recompress_pagefind.mjs';

let zopfli = true;
try {
  execFileSync('zopfli', ['-h'], { stdio: 'ignore' });
} catch (e) {
  zopfli = e.code !== 'ENOENT';
}

describe('isGzip', () => {
  it('recognises the gzip magic number', () => {
    expect(isGzip(gzipSync('x'))).toBe(true);
    expect(isGzip(Buffer.from('pagefind_dcd'))).toBe(false);
  });
});

describe.skipIf(!zopfli)('recompressPagefind', () => {
  it('shrinks gzipped Pagefind files without changing their contents', async () => {
    const dist = mkdtempSync(join(tmpdir(), 'recompress-test-'));
    try {
      mkdirSync(join(dist, 'pagefind', 'fragment'), { recursive: true });
      const body = Buffer.from(
        'pagefind_dcd' + 'the quick brown fox jumps over the lazy dog '.repeat(400),
      );
      const wasm = join(dist, 'pagefind', 'wasm.en.pagefind');
      writeFileSync(wasm, gzipSync(body, { level: 6 }));
      const js = join(dist, 'pagefind', 'pagefind.js');
      writeFileSync(js, 'not gzipped');
      const before = readFileSync(wasm).length;
      const r = await recompressPagefind(dist, { iterations: 5 });
      expect(r.files).toBe(1);
      expect(readFileSync(wasm).length).toBeLessThan(before);
      expect(gunzipSync(readFileSync(wasm)).equals(body)).toBe(true);
      expect(readFileSync(js, 'utf8')).toBe('not gzipped');
    } finally {
      rmSync(dist, { recursive: true, force: true });
    }
  });
});
