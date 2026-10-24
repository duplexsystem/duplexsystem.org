import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  classify,
  fontFaces,
  isPixelArt,
  hoistCriticalLinks,
  minifyCss,
  minifyInlineScripts,
  optimizeSvg,
  prunePagefindWasm,
  rewriteRefs,
} from './optimize_assets.mjs';

describe('classify', () => {
  it('sends lossy sources to webp conversion', () => {
    expect(classify('photo.jpg')).toBe('to-webp');
    expect(classify('photo.jpeg')).toBe('to-webp');
  });

  it('keeps png as png for lossless optimization', () => {
    expect(classify('button.png')).toBe('png-lossless');
  });

  it('optimizes svg in place', () => {
    expect(classify('icon.svg')).toBe('svg');
  });

  it('leaves already-optimal formats alone', () => {
    expect(classify('a.webp')).toBe('skip');
    expect(classify('a.avif')).toBe('skip');
    expect(classify('a.woff2')).toBe('skip');
    expect(classify('a.html')).toBe('skip');
  });

  it('is case-insensitive', () => {
    expect(classify('PHOTO.JPG')).toBe('to-webp');
    expect(classify('BUTTON.PNG')).toBe('png-lossless');
  });
});

describe('classify (js location)', () => {
  it('minifies only js under dist/js, wherever dist itself lives', () => {
    expect(classify('/w/js/site/dist/_astro/a.js', '/w/js/site/dist')).toBe('skip');
    expect(classify('/w/js/site/dist/js/a.js', '/w/js/site/dist')).toBe('js');
    expect(classify('/w/site/dist/js/a.js', '/w/site/dist')).toBe('js');
  });
});

describe('isPixelArt', () => {
  it('judges one frame, not the frames stacked (sharp reports both)', () => {
    expect(isPixelArt({ width: 88, height: 186, pageHeight: 31 })).toBe(true);
    expect(isPixelArt({ width: 88, height: 31 })).toBe(true);
    expect(isPixelArt({ width: 400, height: 300, pageHeight: 300 })).toBe(false);
  });
});

describe('classify (format policy)', () => {
  it('routes gif to animated webp conversion', () => {
    expect(classify('a.gif')).toBe('gif-to-webp');
    expect(classify('A.GIF')).toBe('gif-to-webp');
  });
  it('still routes jpeg to webp and keeps png lossless', () => {
    expect(classify('a.jpg')).toBe('to-webp');
    expect(classify('a.png')).toBe('png-lossless');
  });
  it('leaves webp and svg alone', () => {
    expect(classify('a.webp')).toBe('skip');
    expect(classify('a.svg')).toBe('svg');
  });
});

describe('rewriteRefs', () => {
  it('repoints a converted jpeg to its webp sibling', () => {
    const html = '<img src="/img/a.jpg"><img src="/img/b.jpeg">';
    const out = rewriteRefs(
      html,
      new Map([
        ['/img/a.jpg', '/img/a.webp'],
        ['/img/b.jpeg', '/img/b.webp'],
      ]),
    );
    expect(out).toBe('<img src="/img/a.webp"><img src="/img/b.webp">');
  });

  it('rewrites css url() references too', () => {
    const css = '.x{background:url("/img/a.jpg")}';
    expect(rewriteRefs(css, new Map([['/img/a.jpg', '/img/a.webp']]))).toBe(
      '.x{background:url("/img/a.webp")}',
    );
  });

  it('leaves unrelated text untouched', () => {
    const html = '<p>a.jpg is a filename we merely mention</p>';
    expect(rewriteRefs(html, new Map([['/img/a.jpg', '/img/a.webp']]))).toBe(html);
  });

  it('repoints every candidate in a srcset list, not just an exact match', () => {
    const html = '<img srcset="/img/a.gif 480w, /img/a.gif 800w" src="/img/a.gif">';
    const out = rewriteRefs(html, new Map([['/img/a.gif', '/img/a.webp']]));
    expect(out).toBe('<img srcset="/img/a.webp 480w, /img/a.webp 800w" src="/img/a.webp">');
  });

  it('repoints absolute URLs: og:image, feeds, sitemaps', () => {
    const map = new Map([['/img/a.gif', '/img/a.webp']]);
    const site = 'https://duplexsystem.org';
    expect(rewriteRefs(`<meta content="${site}/img/a.gif">`, map)).toBe(
      `<meta content="${site}/img/a.webp">`,
    );
    expect(rewriteRefs(`{"h":"<img src=\\"${site}/img/a.gif\\">"}`, map)).toBe(
      `{"h":"<img src=\\"${site}/img/a.webp\\">"}`,
    );
    expect(rewriteRefs(`<img src=&quot;${site}/img/a.gif&quot;>`, map)).toBe(
      `<img src=&quot;${site}/img/a.webp&quot;>`,
    );
  });

  it("leaves another site's URL and a longer path alone", () => {
    const map = new Map([['/img/a.gif', '/img/a.webp']]);
    const html = '<img src="https://other.example/img/a.gif"><img src="/x/img/a.gif">';
    expect(rewriteRefs(html, map)).toBe(html);
  });

  it('returns input unchanged when nothing was converted', () => {
    expect(rewriteRefs('<img src="/a.png">', new Map())).toBe('<img src="/a.png">');
  });
});

describe('optimizeSvg', () => {
  it('strips comments and xml declarations', () => {
    const out = optimizeSvg('<?xml version="1.0"?><!-- hi --><svg viewBox="0 0 1 1"><rect/></svg>');
    expect(out).not.toContain('<!--');
    expect(out).not.toContain('<?xml');
  });

  it('preserves viewBox, which every rendered size depends on', () => {
    expect(optimizeSvg('<svg viewBox="0 0 24 24"><rect/></svg>')).toContain('viewBox="0 0 24 24"');
  });

  it('never grows a file', () => {
    const src = '<svg viewBox="0 0 1 1"><rect x="0" y="0" width="1" height="1"/></svg>';
    expect(optimizeSvg(src).length).toBeLessThanOrEqual(src.length);
  });

  it('returns the original when SVGO cannot parse it', () => {
    expect(typeof optimizeSvg('<svg><unclosed>')).toBe('string');
  });
});

describe('optimizeSvg fill survival', () => {
  it('keeps the fill applicable after shape conversion', () => {
    const src =
      '<svg class="a" viewBox="0 0 4 4"><style>.a{fill:currentColor}</style>' +
      '<rect x="0" y="0" width="1" height="1"/></svg>';
    const out = optimizeSvg(src);
    expect(out).toMatch(/\.a\s*\{[^}]*fill:\s*currentColor/);
    expect(out).not.toMatch(/\.a\s+(rect|path)\s*\{[^}]*fill/);
  });
});

describe('minifyCss', () => {
  it('removes comments and whitespace', () => {
    const out = minifyCss('/* hi */\n.a {\n  color: red;\n}\n');
    expect(out).not.toContain('/*');
    expect(out.length).toBeLessThan(30);
  });

  it('preserves declared behavior, not just bytes', () => {
    expect(minifyCss('.a{color:#ff0000}')).toContain('red');
  });

  it('returns the input unchanged when it cannot parse', () => {
    const broken = '.a { color: ;;; @@@ }';
    expect(typeof minifyCss(broken)).toBe('string');
  });

  it('never grows a file', () => {
    const src = '.a{color:red}';
    expect(minifyCss(src).length).toBeLessThanOrEqual(src.length);
  });
});

describe('minifyInlineScripts', () => {
  it('minifies an inline script and drops its comments', async () => {
    const out = await minifyInlineScripts(
      '<script>\n// gone\nconst a = 1;\nconsole.log(a);\n</script>',
    );
    expect(out).not.toContain('// gone');
    expect(out).toContain('<script>');
  });

  it('keeps $ sequences in the minified code literal', async () => {
    const out = await minifyInlineScripts('<script>var a = "$$"; var b = "x$&y";</script>');
    expect(out).toBe('<script>var a="$$",b="x$&y";</script>');
  });

  it('leaves scripts with a src attribute alone', async () => {
    const html = '<script src="/a.js"></script>';
    expect(await minifyInlineScripts(html)).toBe(html);
  });

  it('leaves application/ld+json alone', async () => {
    const html = '<script type="application/ld+json">{ "a": 1 }</script>';
    expect(await minifyInlineScripts(html)).toBe(html);
  });

  it('returns the script unchanged when esbuild cannot parse it', async () => {
    const html = '<script>const ( = ;;;</script>';
    expect(await minifyInlineScripts(html)).toContain('const (');
  });

  it('handles HTML with no scripts', async () => {
    expect(await minifyInlineScripts('<p>hi</p>')).toBe('<p>hi</p>');
  });
});

describe('prunePagefindWasm guard', () => {
  async function makeFixture(entry) {
    const dir = await mkdtemp(join(tmpdir(), 'prune-wasm-'));
    const pagefindDir = join(dir, 'pagefind');
    await mkdir(pagefindDir, { recursive: true });
    if (entry !== undefined) {
      await writeFile(join(pagefindDir, 'pagefind-entry.json'), entry);
    }
    await writeFile(join(pagefindDir, 'wasm.unknown.pagefind'), 'placeholder wasm bytes');
    return dir;
  }

  async function fileExists(path) {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  }

  it('prunes when every language declares its own wasm', async () => {
    const dir = await makeFixture(JSON.stringify({ languages: { en: { wasm: 'en' } } }));
    const wasmPath = join(dir, 'pagefind', 'wasm.unknown.pagefind');

    const saved = await prunePagefindWasm(dir);

    expect(saved).toBeGreaterThan(0);
    expect(await fileExists(wasmPath)).toBe(false);

    await rm(dir, { recursive: true, force: true });
  });

  it('keeps the fallback when any language lacks a wasm field', async () => {
    const dir = await makeFixture(JSON.stringify({ languages: { en: { wasm: 'en' }, xx: {} } }));
    const wasmPath = join(dir, 'pagefind', 'wasm.unknown.pagefind');

    const saved = await prunePagefindWasm(dir);

    expect(saved).toBe(0);
    expect(await fileExists(wasmPath)).toBe(true);

    await rm(dir, { recursive: true, force: true });
  });

  it('keeps the fallback when the entry file is missing or unparseable', async () => {
    const missingDir = await makeFixture(undefined);
    const missingWasm = join(missingDir, 'pagefind', 'wasm.unknown.pagefind');
    expect(await prunePagefindWasm(missingDir)).toBe(0);
    expect(await fileExists(missingWasm)).toBe(true);
    await rm(missingDir, { recursive: true, force: true });

    const badDir = await makeFixture('{ not valid json');
    const badWasm = join(badDir, 'pagefind', 'wasm.unknown.pagefind');
    expect(await prunePagefindWasm(badDir)).toBe(0);
    expect(await fileExists(badWasm)).toBe(true);
    await rm(badDir, { recursive: true, force: true });
  });
});

describe('hoistCriticalLinks', () => {
  const sheet = '<link blocking="render" rel="stylesheet" href="/_astro/style.abc.css">';
  const font = '<link rel="preload" href="/_astro/fonts/a.woff2" as="font" crossorigin>';

  it('puts the stylesheet ahead of the font preloads', () => {
    const out = hoistCriticalLinks(`<head><title>t</title>${font}${sheet}</head>`);
    expect(out.indexOf(sheet)).toBeLessThan(out.indexOf(font));
  });

  it('leaves exactly one stylesheet link', () => {
    const out = hoistCriticalLinks(`<head>${font}${sheet}</head>`);
    expect(out.match(/rel="stylesheet"/g)).toHaveLength(1);
  });

  it('preloads a classic script, which is deferred and fetched at low priority', () => {
    const html = `<head>${sheet}</head><body><script src="/js/crack-email.js" defer></script></body>`;
    expect(hoistCriticalLinks(html)).toContain(
      '<link rel="preload" href="/js/crack-email.js" as="script">',
    );
  });

  it('preloads a script already in the head, where the bump is priority not discovery', () => {
    const html = `<head>${sheet}<script src="/js/crack-email.js" defer></script></head>`;
    expect(hoistCriticalLinks(html)).toContain(
      '<link rel="preload" href="/js/crack-email.js" as="script">',
    );
  });

  it('leaves a third-party script alone', () => {
    const html = `<head>${sheet}</head><body><script src="https://x.test/a.js"></script></body>`;
    expect(hoistCriticalLinks(html)).not.toContain('preload" href="https');
  });

  it('preloads a module script the parser would not reach until the body', () => {
    const src = '/pagefind/pagefind-component-ui.js';
    const html = `<head>${sheet}</head><body><script type="module" src="${src}"></script></body>`;
    const out = hoistCriticalLinks(html);
    expect(out).toContain(`<link rel="modulepreload" href="${src}">`);
    expect(out.indexOf('modulepreload')).toBeLessThan(out.indexOf('</head>'));
  });

  it('does not preload the same module twice', () => {
    const s = '<script type="module" src="/pagefind/pagefind-component-ui.js"></script>';
    const out = hoistCriticalLinks(`<head>${sheet}</head><body>${s}${s}</body>`);
    expect(out.match(/modulepreload/g)).toHaveLength(1);
  });

  it('leaves the small enhancements to be found in the normal way', () => {
    const html = `<head>${sheet}</head><body><script src="/js/code-blocks.js" defer></script></body>`;
    expect(hoistCriticalLinks(html)).not.toContain('preload" href="/js/code-blocks.js"');
  });

  it('leaves a page with no site stylesheet alone', () => {
    const html = '<head><link rel="stylesheet" href="/pagefind/ui.css"></head>';
    expect(hoistCriticalLinks(html)).toBe(html);
  });

  it('still places the stylesheet when a page preloads no fonts', () => {
    const out = hoistCriticalLinks(`<head><title>t</title>${sheet}</head>`);
    expect(out).toContain(sheet);
    expect(out.match(/rel="stylesheet"/g)).toHaveLength(1);
  });

  it('preloads a split face by its core file, never its -ext sibling', () => {
    const faces = fontFaces(
      '@font-face{font-family:JetBrains Mono-x;src:url(/core.woff2);unicode-range:U+20-7E,U+A0-FF;font-weight:400;font-style:normal}' +
        '@font-face{font-family:JetBrains Mono-x;src:url(/ext.woff2);unicode-range:U+100-17F;font-weight:400;font-style:normal}' +
        '@font-face{font-family:Noto Emoji;src:url(/emoji.woff2);unicode-range:U+1F3??}',
    );
    const out = hoistCriticalLinks(
      `<head>${sheet}</head><body><pre>x</pre><span class="emoji">🏳</span></body>`,
      faces,
    );
    expect(out).toContain('href="/core.woff2"');
    expect(out).not.toContain('href="/ext.woff2"');
    expect(out).toContain('href="/emoji.woff2"');
  });
});
