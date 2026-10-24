import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import precompress, { shouldCompress, isWorthKeeping } from './precompress.mjs';

describe('shouldCompress', () => {
  it('compresses text formats', () => {
    for (const f of ['a.html', 'a.css', 'a.js', 'a.svg', 'a.json', 'a.xml', 'a.txt']) {
      expect(shouldCompress(f)).toBe(true);
    }
  });

  it('skips already-compressed formats', () => {
    for (const f of ['a.woff2', 'a.avif', 'a.webp', 'a.png', 'a.jpg', 'a.br', 'a.gz']) {
      expect(shouldCompress(f)).toBe(false);
    }
  });

  it('is case-insensitive on the extension', () => {
    expect(shouldCompress('A.HTML')).toBe(true);
    expect(shouldCompress('A.PNG')).toBe(false);
  });
});

describe('precompress', () => {
  it('writes .br/.gz siblings and drops ones a rewrite left stale', async () => {
    const dist = await mkdtemp(join(tmpdir(), 'precompress-'));
    try {
      const page = join(dist, 'a.html');
      await writeFile(page, '<p>hello</p>'.repeat(200));
      await precompress(dist);
      expect(gunzipSync(await readFile(`${page}.gz`)).toString()).toContain('hello');
      expect(existsSync(`${page}.br`)).toBe(true);

      await writeFile(page, 'x');
      await precompress(dist);
      expect(existsSync(`${page}.br`)).toBe(false);
      expect(existsSync(`${page}.gz`)).toBe(false);
    } finally {
      await rm(dist, { recursive: true, force: true });
    }
  });
});

describe('isWorthKeeping', () => {
  it('keeps a compressed file that saved even one byte', () => {
    expect(isWorthKeeping(1000, 999)).toBe(true);
  });

  it('discards a compressed file that did not shrink', () => {
    expect(isWorthKeeping(1000, 1000)).toBe(false);
  });

  it('discards a compressed file that grew', () => {
    expect(isWorthKeeping(1000, 1200)).toBe(false);
  });
});
