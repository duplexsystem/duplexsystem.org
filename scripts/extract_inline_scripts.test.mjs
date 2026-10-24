import { describe, expect, it } from 'vitest';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import extractInlineScripts, { PRIVACY } from './extract_inline_scripts.mjs';

describe('extracted video players', () => {
  it('cover both embeds astro-embed ships', () => {
    expect(Object.keys(PRIVACY).sort()).toEqual(['lite-vimeo', 'lite-youtube']);
    expect(PRIVACY['lite-youtube']).toMatch(/preconnected = true/);
    expect(PRIVACY['lite-youtube']).toMatch(/needsYTApi = false/);
    expect(PRIVACY['lite-vimeo']).toMatch(/preconnected = true/);
  });

  it('get the no-contact-before-play settings after their definition', async () => {
    const dist = await mkdtemp(join(tmpdir(), 'extract-'));
    try {
      const body = 'class e extends HTMLElement{};customElements.define("lite-vimeo",e)';
      await writeFile(
        join(dist, 'index.html'),
        `<html><head></head><body><lite-vimeo></lite-vimeo><script type="module">${body}</script></body></html>`,
      );
      await extractInlineScripts(dist);
      const js = await readFile(join(dist, 'js', 'lite-vimeo.js'), 'utf8');
      expect(js.indexOf(PRIVACY['lite-vimeo'])).toBeGreaterThan(js.indexOf(body));
      expect(await readFile(join(dist, 'index.html'), 'utf8')).toContain(
        '<script type="module" src="/js/lite-vimeo.js"></script>',
      );
    } finally {
      await rm(dist, { recursive: true, force: true });
    }
  });

  const privacyCount = (js, name) => js.split(PRIVACY[name]).length - 1;

  it('treats a module Astro bundled under /_astro/ the same: moved, privacy appended once', async () => {
    const dist = await mkdtemp(join(tmpdir(), 'extract-'));
    try {
      await mkdir(join(dist, '_astro'));
      const body = 'class e extends HTMLElement{};customElements.define("lite-vimeo",e)';
      await writeFile(join(dist, '_astro', 'lite-vimeo.abc.js'), `${body}\n`);
      const page = (extra = '') =>
        `<html><body><script src="/_astro/lite-vimeo.abc.js" type="module"></script>${extra}</body></html>`;
      await writeFile(join(dist, 'a.html'), page());
      await writeFile(join(dist, 'b.html'), page());
      await extractInlineScripts(dist);
      await extractInlineScripts(dist);
      const js = await readFile(join(dist, 'js', 'lite-vimeo.js'), 'utf8');
      expect(privacyCount(js, 'lite-vimeo')).toBe(1);
      expect(js).toContain(body);
      expect(await readFile(join(dist, 'b.html'), 'utf8')).toContain(
        '<script type="module" src="/js/lite-vimeo.js"></script>',
      );
      await expect(access(join(dist, '_astro', 'lite-vimeo.abc.js'))).rejects.toThrow();
    } finally {
      await rm(dist, { recursive: true, force: true });
    }
  });

  it('gives the settings to every embed a shared module defines, and to one used inline and bundled', async () => {
    const dist = await mkdtemp(join(tmpdir(), 'extract-'));
    try {
      await mkdir(join(dist, '_astro'));
      const both =
        'class a extends HTMLElement{};class b extends HTMLElement{};' +
        'customElements.define("lite-youtube",a);customElements.define("lite-vimeo",b)';
      await writeFile(join(dist, '_astro', 'both.js'), both);
      await writeFile(
        join(dist, 'index.html'),
        '<script type="module" src="/_astro/both.js"></script>' +
          `<script type="module">${both}</script>`,
      );
      await extractInlineScripts(dist);
      const js = await readFile(join(dist, 'js', 'lite-youtube.js'), 'utf8');
      expect(privacyCount(js, 'lite-youtube')).toBe(1);
      expect(privacyCount(js, 'lite-vimeo')).toBe(1);
    } finally {
      await rm(dist, { recursive: true, force: true });
    }
  });
});
