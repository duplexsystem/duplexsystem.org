import { describe, it, expect } from 'vitest';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  noThirdPartyStylesheet,
  noGistWidget,
  noEmbedInlineBackground,
  unreferencedAstroAssets,
  countEmbedFigures,
} from './check_embeds.mjs';

describe('countEmbedFigures', () => {
  it('counts zero on a page with no embeds', () => {
    expect(countEmbedFigures('<p>hello</p><figure class="frame chart"></figure>')).toBe(0);
  });

  it('counts each frame--embed figure once, ignoring plain .frame figures', () => {
    const html =
      '<figure class="frame frame--embed"></figure><figure class="frame"></figure><figure class="frame frame--embed"></figure>';
    expect(countEmbedFigures(html)).toBe(2);
  });
});

describe('noThirdPartyStylesheet', () => {
  it('fails on an absolute http(s) stylesheet link (the Gist shadow-root regression)', () => {
    const html =
      '<link rel="stylesheet" href="https://github.githubassets.com/assets/gist-embed-f120d08b.css">';
    expect(noThirdPartyStylesheet(html)).toBe(false);
  });

  it('fails regardless of attribute order', () => {
    const html = '<link href="https://example.com/x.css" rel="stylesheet">';
    expect(noThirdPartyStylesheet(html)).toBe(false);
  });

  it('passes a root-relative, self-hosted stylesheet link', () => {
    const html = '<link rel="stylesheet" href="/_astro/GlobalStyles.abc123.css">';
    expect(noThirdPartyStylesheet(html)).toBe(true);
  });

  it('passes a page with no stylesheet link at all', () => {
    expect(noThirdPartyStylesheet('<p>hello</p>')).toBe(true);
  });
});

describe('noGistWidget', () => {
  it("fails when astro-embed's own <astro-embed-gist> is present", () => {
    const html =
      '<figure class="frame frame--embed"><div class="frame__body"><astro-embed-gist><template shadowrootmode="open"></template></astro-embed-gist></div></figure>';
    expect(noGistWidget(html)).toBe(false);
  });

  it('passes our own replacement (.gist / .codefig, no custom element)', () => {
    const html =
      '<figure class="frame frame--embed"><div class="frame__body"><div class="gist"><figure class="codefig"><figcaption class="codehead">hello.rb</figcaption><pre>code</pre></figure><a class="gist-source" href="https://gist.github.com/x">view on github</a></div></div></figure>';
    expect(noGistWidget(html)).toBe(true);
  });
});

describe('noEmbedInlineBackground', () => {
  it('fails on an inline opaque background-color inside a frame--embed figure', () => {
    const html =
      '<figure class="frame frame--embed"><div class="frame__body"><div class="bluesky-post-container" style="background-color: #161e27;"></div></div></figure>';
    expect(noEmbedInlineBackground(html)).toBe(false);
  });

  it('fails on the background shorthand too', () => {
    const html =
      '<figure class="frame frame--embed"><div class="frame__body"><div style="background: #fff"></div></div></figure>';
    expect(noEmbedInlineBackground(html)).toBe(false);
  });

  it('passes an explicit transparent/none background', () => {
    const html =
      '<figure class="frame frame--embed"><div class="frame__body"><div style="background-color: transparent;"></div><div style="background: none;"></div></div></figure>';
    expect(noEmbedInlineBackground(html)).toBe(true);
  });

  it("ignores background-image (YouTube/Vimeo's legitimate lazy-thumbnail placeholder, out of scope)", () => {
    const html =
      '<figure class="frame frame--embed"><div class="frame__body"><lite-youtube style="background-image: url(\'https://i.ytimg.com/vi/x/hqdefault.jpg\')"></lite-youtube></div></figure>';
    expect(noEmbedInlineBackground(html)).toBe(true);
  });

  it('ignores an inline background outside any frame--embed figure', () => {
    const html = '<div style="background-color: #161e27;"></div>';
    expect(noEmbedInlineBackground(html)).toBe(true);
  });

  it("ignores Shiki's own inline theme background on a Gist's <pre> (our theme, not a reintroduced third-party card)", () => {
    const html =
      '<figure class="frame frame--embed"><div class="frame__body"><div class="gist"><figure class="codefig"><pre style="background-color:#130e1c;color:#ddd4ea">code</pre></figure></div></div></figure>';
    expect(noEmbedInlineBackground(html)).toBe(true);
  });

  it("still fails a non-<pre> element with an opaque inline background sitting next to a Gist's <pre>", () => {
    const html =
      '<figure class="frame frame--embed"><div class="frame__body"><div class="gist" style="background-color:#161e27"><pre style="background-color:#130e1c;color:#ddd4ea">code</pre></div></div></figure>';
    expect(noEmbedInlineBackground(html)).toBe(false);
  });

  it("catches an opaque background sitting after a nested <figure> closes (I4: a Gist file's own .codefig figure previously truncated the match at the first </figure>)", () => {
    const html =
      '<figure class="frame frame--embed"><div class="frame__body"><div class="gist">' +
      '<figure class="codefig"><figcaption class="codehead">a.rb</figcaption><pre style="background-color:#130e1c;color:#ddd4ea">code</pre></figure>' +
      '<div style="background-color:#161e27">evil, after the nested figure closes</div>' +
      '</div></div></figure>';
    expect(noEmbedInlineBackground(html)).toBe(false);
  });

  it('handles a multi-file Gist (two nested .codefig figures) with no false positive when both are clean', () => {
    const html =
      '<figure class="frame frame--embed"><div class="frame__body"><div class="gist">' +
      '<figure class="codefig"><pre style="background-color:#130e1c;color:#ddd4ea">a</pre></figure>' +
      '<figure class="codefig"><pre style="background-color:#130e1c;color:#ddd4ea">b</pre></figure>' +
      '<a class="gist-source" href="https://gist.github.com/x">view on github</a>' +
      '</div></div></figure>';
    expect(noEmbedInlineBackground(html)).toBe(true);
  });
});

describe('unreferencedAstroAssets', () => {
  it('flags an asset under dist/_astro that no built file mentions', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'check-embeds-'));
    try {
      await mkdir(join(dir, '_astro'), { recursive: true });
      await writeFile(join(dir, '_astro', 'dead.abc123.svg'), '<svg></svg>');
      await writeFile(join(dir, 'index.html'), '<!doctype html><p>hello</p>');

      const dead = await unreferencedAstroAssets(dir);

      expect(dead).toEqual(['_astro/dead.abc123.svg']);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('does not flag an asset referenced from HTML', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'check-embeds-'));
    try {
      await mkdir(join(dir, '_astro'), { recursive: true });
      await writeFile(join(dir, '_astro', 'used.abc123.svg'), '<svg></svg>');
      await writeFile(join(dir, 'index.html'), '<img src="/_astro/used.abc123.svg">');

      expect(await unreferencedAstroAssets(dir)).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('does not flag a font only reachable via a CSS url(), not any HTML', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'check-embeds-'));
    try {
      await mkdir(join(dir, '_astro', 'fonts'), { recursive: true });
      await writeFile(join(dir, '_astro', 'fonts', 'font.abc123.woff2'), Buffer.alloc(10));
      await writeFile(
        join(dir, '_astro', 'style.abc123.css'),
        '@font-face{src:url(/_astro/fonts/font.abc123.woff2)}',
      );
      await writeFile(
        join(dir, 'index.html'),
        '<link rel="stylesheet" href="/_astro/style.abc123.css">',
      );

      expect(await unreferencedAstroAssets(dir)).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('does not flag an image only reachable via srcset, which no single href/src attribute captures', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'check-embeds-'));
    try {
      await mkdir(join(dir, '_astro'), { recursive: true });
      await writeFile(join(dir, '_astro', 'hero-400.abc.webp'), Buffer.alloc(10));
      await writeFile(
        join(dir, 'index.html'),
        '<img src="/_astro/hero-800.abc.webp" srcset="/_astro/hero-400.abc.webp 400w, /_astro/hero-800.abc.webp 800w">',
      );

      expect(await unreferencedAstroAssets(dir)).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('ignores precompressed .br/.gz siblings: never referenced by name, the server negotiates encoding', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'check-embeds-'));
    try {
      await mkdir(join(dir, '_astro'), { recursive: true });
      await writeFile(join(dir, '_astro', 'used.abc123.css'), 'body{}');
      await writeFile(join(dir, '_astro', 'used.abc123.css.br'), Buffer.alloc(5));
      await writeFile(join(dir, '_astro', 'used.abc123.css.gz'), Buffer.alloc(5));
      await writeFile(
        join(dir, 'index.html'),
        '<link rel="stylesheet" href="/_astro/used.abc123.css">',
      );

      expect(await unreferencedAstroAssets(dir)).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('flags an error artwork nothing references: the old inline-era allowlist is gone, external art must be linked', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'check-embeds-'));
    try {
      await mkdir(join(dir, '_astro'), { recursive: true });
      await writeFile(join(dir, '_astro', 'err-404.CdKlJ4l0.svg'), '<svg></svg>');
      await writeFile(join(dir, '404.html'), '<svg><style>@keyframes x{}</style></svg>');

      expect(await unreferencedAstroAssets(dir)).toEqual(['_astro/err-404.CdKlJ4l0.svg']);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('still flags an unrelated asset that merely starts with "err": the allowlist matches err-<status code> exactly, not a loose prefix', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'check-embeds-'));
    try {
      await mkdir(join(dir, '_astro'), { recursive: true });
      await writeFile(join(dir, '_astro', 'error-log.abc123.svg'), '<svg></svg>');
      await writeFile(join(dir, 'index.html'), '<p>hello</p>');

      expect(await unreferencedAstroAssets(dir)).toEqual(['_astro/error-log.abc123.svg']);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('returns an empty array when dist has no _astro directory at all', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'check-embeds-'));
    try {
      await writeFile(join(dir, 'index.html'), '<p>hello</p>');
      expect(await unreferencedAstroAssets(dir)).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
