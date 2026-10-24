import { describe, it, expect } from 'vitest';
import { attr, rewritePages, swap } from './html.mjs';
import { cached } from './cache.mjs';
import { hash8, hashedName, sha256 } from './hash.mjs';
import { mapPool } from './pool.mjs';
import { isMain } from './main.mjs';
import { pathToFileURL } from 'node:url';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('swap', () => {
  it('inserts the replacement literally', () => {
    expect(swap('a-b', '-', "$$ $& $' $`")).toBe("a$$ $& $' $`b");
  });
});

describe('attr', () => {
  it('reads a double-quoted attribute, case-insensitively', () => {
    expect(attr('<img SRC="/a.png" width="3">', 'src')).toBe('/a.png');
    expect(attr('<img src="/a.png">', 'alt')).toBeNull();
  });
  it('does not mistake data-<name> for <name>', () => {
    expect(attr('<img data-src="/lazy.png">', 'src')).toBeNull();
    expect(attr('<img data-src="/lazy.png" src="/real.png">', 'src')).toBe('/real.png');
  });
});

describe('sha256', () => {
  it('hashes its parts as if concatenated', () => {
    expect(sha256('a', Buffer.from('bc'))).toBe(sha256('abc'));
    expect(sha256('abc').startsWith('ba7816bf')).toBe(true);
  });
});

describe('mapPool', () => {
  it('keeps input order and never exceeds the limit', async () => {
    let live = 0;
    let peak = 0;
    const out = await mapPool(
      [5, 1, 4, 2, 3],
      async (n) => {
        peak = Math.max(peak, ++live);
        await new Promise((r) => setTimeout(r, n));
        live--;
        return n * 2;
      },
      2,
    );
    expect(out).toEqual([10, 2, 8, 4, 6]);
    expect(peak).toBe(2);
  });
  it('handles no items', async () => {
    expect(await mapPool([], async () => 1)).toEqual([]);
  });
});

describe('hashedName', () => {
  it('puts the content hash before the extension', () => {
    expect(hashedName('/x/btn.png', 'abc')).toBe(`btn.${hash8('abc')}.png`);
    expect(hash8('abc')).toBe('ba7816bf');
  });
});

describe('isMain', () => {
  it('is false for a module that is not the entry script', () => {
    expect(isMain(pathToFileURL('/nowhere/else.mjs').href)).toBe(false);
  });
});

describe('cached', () => {
  it('produces once, stores whole, and stores nothing when production throws', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cache-'));
    try {
      let calls = 0;
      const make = async () => (calls++, 'bytes');
      expect((await cached(dir, 'k', make)).toString()).toBe('bytes');
      expect((await cached(dir, 'k', make)).toString()).toBe('bytes');
      expect(calls).toBe(1);
      await expect(
        cached(dir, 'bad', async () => {
          throw new Error('no');
        }),
      ).rejects.toThrow('no');
      expect(await readdir(dir)).toEqual(['k']);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('rewritePages', () => {
  it('writes back only pages whose html changed, and counts them', async () => {
    const dist = await mkdtemp(join(tmpdir(), 'pages-'));
    try {
      await writeFile(join(dist, 'a.html'), 'a');
      await writeFile(join(dist, 'b.html'), 'b');
      await writeFile(join(dist, 'c.txt'), 'a');
      const n = await rewritePages(dist, (html) => (html === 'a' ? 'A' : undefined));
      expect(n).toBe(1);
      expect(await readFile(join(dist, 'a.html'), 'utf8')).toBe('A');
      expect(await readFile(join(dist, 'b.html'), 'utf8')).toBe('b');
      expect(await readFile(join(dist, 'c.txt'), 'utf8')).toBe('a');
    } finally {
      await rm(dist, { recursive: true, force: true });
    }
  });
});
