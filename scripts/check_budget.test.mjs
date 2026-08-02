import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { referencedAssets, pageWeight } from './check_budget.mjs';

describe('referencedAssets', () => {
  it('finds href/src attributes', () => {
    const html = '<link rel="stylesheet" href="/a.css"><img src="/b.png">';
    expect(referencedAssets(html).sort()).toEqual(['/a.css', '/b.png']);
  });

  it('finds url(...) references inside CSS text', () => {
    const css = '@font-face{src:url("/font.woff2")}';
    expect(referencedAssets(css)).toEqual(['/font.woff2']);
  });

  it('ignores <a href> to an asset: a hyperlink is not an automatic page load', () => {
    // The regression this guards: /licenses/ links directly to
    // /pagefind/*.js so a human (and LibreJS) can open the actual served
    // script. That link must not make the page inherit the script's weight.
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
      const fontBytes = 500_000; // stands in for an oversized, un-subset font
      await writeFile(join(dir, 'style.css'), '@font-face{src:url("/font.woff2")}');
      await writeFile(join(dir, 'font.woff2'), Buffer.alloc(fontBytes));
      const html = '<!doctype html><link rel="stylesheet" href="/style.css">';

      const total = await pageWeight(dir, html);

      // This is the regression the whole change is about: without following
      // the linked .css one level to find the url() inside it, the font's
      // bytes would never be added, and this assertion would fail regardless
      // of how oversized the font is.
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
