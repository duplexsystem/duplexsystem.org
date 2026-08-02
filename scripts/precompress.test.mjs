import { describe, it, expect } from 'vitest';
import { shouldCompress, isWorthKeeping } from './precompress.mjs';

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

describe('isWorthKeeping', () => {
  it('keeps a compressed file at least 10% smaller', () => {
    expect(isWorthKeeping(1000, 900)).toBe(true);
  });

  it('discards a file under the 10% threshold', () => {
    expect(isWorthKeeping(1000, 901)).toBe(false);
  });

  it('discards a compressed file that grew', () => {
    expect(isWorthKeeping(1000, 1200)).toBe(false);
  });
});
