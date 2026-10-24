import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  ELIGIBLE,
  protectedInHtml,
  protectedInManifest,
  sitePath,
  wellKnownButton,
} from './lib/jxl.mjs';
import makeJxl, { lossyArgs, sourceStem, ssim, stem, webpIsLossless } from './make_jxl.mjs';

describe('ELIGIBLE', () => {
  it('takes hashed images under /_astro/ and hashed buttons', () => {
    expect(ELIGIBLE.test('_astro/kitchen-hero.CQTcB_1c_11wyQ8.webp')).toBe(true);
    expect(ELIGIBLE.test('_astro/og-default.XqbX_OmO.png')).toBe(true);
    expect(ELIGIBLE.test('buttons/tranarchy.b9140374.webp')).toBe(true);
    expect(ELIGIBLE.test('buttons/bloeckchengrafik.still.770600db.webp')).toBe(true);
  });
  it('never takes stable names, the site root, SVGs or other types', () => {
    expect(ELIGIBLE.test('buttons/duplexsystem.png')).toBe(false);
    expect(ELIGIBLE.test('apple-touch-icon.png')).toBe(false);
    expect(ELIGIBLE.test('icon-192.png')).toBe(false);
    expect(ELIGIBLE.test('favicon.ico')).toBe(false);
    expect(ELIGIBLE.test('_astro/search.BdUC-Ta0.svg')).toBe(false);
    expect(ELIGIBLE.test('_astro/fonts.css')).toBe(false);
    expect(ELIGIBLE.test('_astro/sub/x.abcd1234.png')).toBe(false);
  });
});

describe('protection', () => {
  it('reads site paths from absolute and root-relative URLs only', () => {
    expect(sitePath('https://duplexsystem.org/_astro/og.png?v=1')).toBe('_astro/og.png');
    expect(sitePath('/icon-192.png')).toBe('icon-192.png');
    expect(sitePath('https://example.com/x.png')).toBe(null);
    expect(sitePath('//cdn.example/x.png')).toBe(null);
  });

  it('protects icons and social images named in a page', () => {
    const html = `<head>
      <link rel="icon" href="/favicon.svg" type="image/svg+xml">
      <link rel="apple-touch-icon" href="/apple-touch-icon.png">
      <link rel="stylesheet" href="/_astro/a.css">
      <meta property="og:image" content="https://duplexsystem.org/_astro/og-default.XqbX_OmO.png">
      <meta name="twitter:image" content="/_astro/card.abc.png">
      <img src="/buttons/tranarchy.b9140374.webp">`;
    expect([...protectedInHtml(html)].sort()).toEqual([
      '_astro/card.abc.png',
      '_astro/og-default.XqbX_OmO.png',
      'apple-touch-icon.png',
      'favicon.svg',
    ]);
  });

  it('protects manifest icons', () => {
    const m = JSON.stringify({ icons: [{ src: '/icon-192.png' }, { src: '/icon-512.png' }] });
    expect([...protectedInManifest(m)].sort()).toEqual(['icon-192.png', 'icon-512.png']);
    expect([...protectedInManifest('not json')]).toEqual([]);
  });

  it('finds the /.well-known/button target in the real nginx maps', () => {
    expect(wellKnownButton(readFileSync('nginx/maps.conf', 'utf8'))).toBe(
      'buttons/duplexsystem.png',
    );
  });
});

describe('make_jxl helpers', () => {
  it('matches a built file to its source by name, minus hash and .still', () => {
    expect(stem('dist/buttons/bloeckchengrafik.still.770600db.webp')).toBe('bloeckchengrafik');
    expect(stem('dist/_astro/kitchen-hero.CQTcB_1c_11wyQ8.webp')).toBe('kitchen-hero');
    expect(stem('dist/_astro/kitchen-large.CYKB_wjE.webp')).toBe('kitchen-large');
    expect(sourceStem('src/assets/kitchen-hero.png')).toBe('kitchen-hero');
  });
  it('keeps dots that belong to the source name', () => {
    expect(stem('dist/_astro/v1.2-x.CQTcB_1c.webp')).toBe('v1.2-x');
    expect(sourceStem('src/assets/v1.2-x.png')).toBe('v1.2-x');
  });
  it('tells lossless WebP from lossy', () => {
    const riff = (chunk) => Buffer.concat([Buffer.from('RIFF\0\0\0\0WEBP'), Buffer.from(chunk)]);
    expect(webpIsLossless(riff('VP8L'))).toBe(true);
    expect(webpIsLossless(riff('VP8 '))).toBe(false);
  });
});

describe('quality matching', () => {
  const img = (f) => ({ data: Uint8Array.from({ length: 256 }, (_, i) => f(i)), w: 16, h: 16 });
  it('scores SSIM 1 for identical images and lower as they diverge', () => {
    const a = img((i) => (i * 7) % 256);
    expect(ssim(a, a)).toBeCloseTo(1, 6);
    expect(
      ssim(
        a,
        img((i) => ((i * 7) % 256) ^ 8),
      ),
    ).toBeLessThan(1);
    expect(
      ssim(
        a,
        img((i) => 255 - ((i * 7) % 256)),
      ),
    ).toBeLessThan(0);
  });
});

describe('progressive copies', () => {
  it('encode lossy copies with the preview first, which browsers need to paint early', () => {
    expect(lossyArgs(1)).toContain('--progressive_dc=1');
  });
});

describe('nginx negotiation config', () => {
  const site = readFileSync('nginx/site.conf', 'utf8');
  const jxl = readFileSync('nginx/jxl.conf', 'utf8');
  it('negotiates only in the hashed image locations', () => {
    expect(site.match(/include \/etc\/nginx\/dxs\/jxl\.conf;/g)).toHaveLength(2);
    const buttons = site.slice(site.indexOf('location /buttons/ {'));
    expect(buttons.slice(0, buttons.indexOf('}'))).not.toContain('jxl.conf');
  });
  it('sends Vary and the download name only with the JPEG XL copy', () => {
    expect(jxl).toContain('add_header Vary $jxl_vary;');
    expect(jxl).toContain('add_header Content-Disposition $jxl_disposition;');
  });
});

describe('stale copies', () => {
  const haveCjxl = spawnSync('cjxl', ['--version'], { stdio: 'ignore' }).status === 0;
  it.skipIf(!haveCjxl)(
    'are removed when their image is gone or no longer eligible',
    async () => {
      const dist = await mkdtemp(join(tmpdir(), 'jxl-'));
      try {
        await mkdir(join(dist, '_astro'));
        await mkdir(join(dist, 'buttons'));
        for (const name of ['_astro/gone.abcd1234.png.jxl', 'buttons/duplexsystem.png.jxl'])
          await writeFile(join(dist, name), 'stale');
        await makeJxl(dist, dist);
        await expect(access(join(dist, '_astro/gone.abcd1234.png.jxl'))).rejects.toThrow();
        await expect(access(join(dist, 'buttons/duplexsystem.png.jxl'))).rejects.toThrow();
      } finally {
        await rm(dist, { recursive: true, force: true });
      }
    },
    30_000,
  );
});
