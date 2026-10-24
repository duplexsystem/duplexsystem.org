import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { referencedAssets, pageWeight, unusedRangedFonts } from './check_budget.mjs';

describe('referencedAssets', () => {
  it('finds href/src attributes', () => {
    const html = '<link rel="stylesheet" href="/a.css"><img src="/b.png">';
    expect(referencedAssets(html).sort()).toEqual(['/a.css', '/b.png']);
  });

  it('finds url(...) references inside CSS text', () => {
    const css = '@font-face{src:url("/font.woff2")}';
    expect(referencedAssets(css)).toEqual(['/font.woff2']);
  });

  it('counts srcset candidates, <source> and poster: they are fetched too', () => {
    const html = `<img src="/a.webp" srcset="/a.webp 1x, /a2.webp 2x">
      <picture><source srcset="/b.webp"><img src="/c.png"></picture><video poster="/p.png">`;
    expect(referencedAssets(html).sort()).toEqual(
      ['/a.webp', '/a2.webp', '/b.webp', '/c.png', '/p.png'].sort(),
    );
  });

  it('ignores <a href> to an asset: a hyperlink is not an automatic page load', () => {
    const html = '<a href="/pagefind/pagefind.js">pagefind.js</a>';
    expect(referencedAssets(html)).toEqual([]);
  });

  it('still finds <script src> even though <a href> is ignored', () => {
    const html =
      '<a href="/pagefind/pagefind.js">pagefind.js</a><script src="/widget.js"></script>';
    expect(referencedAssets(html)).toEqual(['/widget.js']);
  });
});

describe('pageWeight', () => {
  it('follows an external stylesheet one level, catching a font referenced only via its url()', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'check-budget-'));
    try {
      const fontBytes = 500_000;
      await writeFile(join(dir, 'style.css'), '@font-face{src:url("/font.woff2")}');
      await writeFile(join(dir, 'font.woff2'), Buffer.alloc(fontBytes));
      const html = '<!doctype html><link rel="stylesheet" href="/style.css">';

      const total = await pageWeight(dir, html);

      expect(total).toBeGreaterThanOrEqual(fontBytes);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('still counts a font referenced directly from inline HTML (no external stylesheet)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'check-budget-'));
    try {
      const fontBytes = 200_000;
      await writeFile(join(dir, 'font.woff2'), Buffer.alloc(fontBytes));
      const html = '<style>@font-face{src:url("/font.woff2")}</style>';

      const total = await pageWeight(dir, html);

      expect(total).toBeGreaterThanOrEqual(fontBytes);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('does not throw when a referenced stylesheet is missing on disk', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'check-budget-'));
    try {
      const html = '<link rel="stylesheet" href="/missing.css">';
      await expect(pageWeight(dir, html)).resolves.toBe(Buffer.byteLength(html));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('pageWeight counts bytes as sent', () => {
  it('uses a precompressed .br sibling for the page and its assets', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'budget-br-'));
    try {
      const html = '<link rel="stylesheet" href="/a.css"><img src="/i.png">' + 'x'.repeat(5000);
      writeFileSync(join(dir, 'index.html'), html);
      writeFileSync(join(dir, 'index.html.br'), 'y'.repeat(300));
      writeFileSync(join(dir, 'a.css'), 'z'.repeat(4000));
      writeFileSync(join(dir, 'a.css.br'), 'z'.repeat(400));
      writeFileSync(join(dir, 'i.png'), 'p'.repeat(2000));
      expect(await pageWeight(dir, html, join(dir, 'index.html'))).toBe(300 + 400 + 2000);
      expect(await pageWeight(dir, html)).toBe(html.length + 400 + 2000);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('unusedRangedFonts', () => {
  const css =
    '@font-face{src:url(/core.woff2);unicode-range:U+20-7E,U+A0-FF}' +
    '@font-face{src:url(/ext.woff2);unicode-range:U+100-17F}' +
    '@font-face{src:url(/emoji.woff2);unicode-range:U+1F3??}' +
    '@font-face{src:url(/plain.woff2)}';

  it('skips faces whose range the page never uses', () => {
    expect([...unusedRangedFonts(css, 'plain ascii')].sort()).toEqual([
      '/emoji.woff2',
      '/ext.woff2',
    ]);
  });

  it('keeps a face once the page uses one of its characters, wildcards included', () => {
    expect([...unusedRangedFonts(css, 'Łódź 🏳')]).toEqual([]);
  });
});

describe('pageWeight with unicode-range', () => {
  it('does not charge a page for a range-gated face it cannot trigger', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'check-budget-'));
    try {
      await writeFile(
        join(dir, 'style.css'),
        '@font-face{src:url("/ext.woff2");unicode-range:U+100-17F}',
      );
      await writeFile(join(dir, 'ext.woff2'), Buffer.alloc(300_000));
      const ascii = '<link rel="stylesheet" href="/style.css">hello';

      expect(await pageWeight(dir, ascii)).toBeLessThan(300_000);
      expect(await pageWeight(dir, ascii + ' Łódź')).toBeGreaterThanOrEqual(300_000);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
