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
  playerPrivacyGaps,
  playerPrivacyProblems,
  playersUsed,
} from './check_embeds.mjs';
import { PRIVACY } from './extract_inline_scripts.mjs';

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

  it('sees single quotes, bare values, protocol-relative URLs and a multi-token rel', () => {
    expect(noThirdPartyStylesheet("<link rel='stylesheet' href='https://x.test/a.css'>")).toBe(
      false,
    );
    expect(noThirdPartyStylesheet('<link href=//x.test/a.css rel=stylesheet>')).toBe(false);
    expect(
      noThirdPartyStylesheet('<link rel="alternate stylesheet" href="http://x.test/a.css">'),
    ).toBe(false);
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

describe('unreferencedAstroAssets and .jxl copies', () => {
  it('does not flag a .jxl beside a referenced image: nginx picks it by Accept, markup never names it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'check-embeds-'));
    try {
      await mkdir(join(dir, '_astro'), { recursive: true });
      await writeFile(join(dir, '_astro', 'hero.Abc123_Z1.webp'), 'x');
      await writeFile(join(dir, '_astro', 'hero.Abc123_Z1.webp.jxl'), 'x');
      await writeFile(join(dir, 'index.html'), '<img src="/_astro/hero.Abc123_Z1.webp">');

      expect(await unreferencedAstroAssets(dir)).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('player privacy', () => {
  const YT =
    'class e{};customElements.define("lite-youtube",e);{const s=customElements.get("lite-youtube");s.preconnected=!0;for(const t of document.querySelectorAll("lite-youtube"))t.needsYTApi=!1}';
  const VIMEO =
    'customElements.define("lite-vimeo",e);customElements.get("lite-vimeo").preconnected=!0;';

  it('accepts the minified output of the settings the build appends', () => {
    expect(playerPrivacyGaps(YT).get('lite-youtube')).toEqual([]);
    expect(playerPrivacyGaps(VIMEO).get('lite-vimeo')).toEqual([]);
  });

  it('accepts the unminified PRIVACY source itself (the gate and the build agree)', () => {
    for (const name of Object.keys(PRIVACY)) {
      const js = `customElements.define('${name}', e);\n${PRIVACY[name]}`;
      expect(playerPrivacyGaps(js).get(name)).toEqual([]);
    }
  });

  it('flags each missing setting, and a flipped one', () => {
    expect(
      playerPrivacyGaps('customElements.define("lite-youtube",e);').get('lite-youtube'),
    ).toHaveLength(2);
    expect(
      playerPrivacyGaps(YT.replace('needsYTApi=!1', 'needsYTApi=!0')).get('lite-youtube'),
    ).toHaveLength(1);
    expect(playerPrivacyGaps(VIMEO.replace('!0', '!1')).get('lite-vimeo')).toHaveLength(1);
  });

  it('does not count settings that come before the define', () => {
    expect(
      playerPrivacyGaps('x.preconnected=!0;customElements.define("lite-vimeo",e);').get(
        'lite-vimeo',
      ),
    ).toHaveLength(1);
  });

  it('finds players a page uses', () => {
    expect([...playersUsed('<lite-youtube videoid="x"></lite-youtube><p>lite-vimeo</p>')]).toEqual([
      'lite-youtube',
    ]);
  });

  it('cannot pass vacuously: a used player with no defining script fails', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'priv-'));
    try {
      await mkdir(join(dir, 'js'));
      await writeFile(join(dir, 'js', 'other.js'), 'console.log(1)');
      const used = new Map([['/p.html', new Set(['lite-vimeo'])]]);
      expect(await playerPrivacyProblems(dir, used)).toEqual([
        expect.stringContaining('no shipped script defines'),
      ]);
      await writeFile(join(dir, 'js', 'lite-vimeo.js'), VIMEO);
      expect(await playerPrivacyProblems(dir, used)).toEqual([]);
      await mkdir(join(dir, '_astro'));
      await writeFile(join(dir, '_astro', 'x.js'), 'customElements.define("lite-vimeo",e)');
      expect(await playerPrivacyProblems(dir, used)).toEqual([expect.stringContaining('lacks')]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
