import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  classify,
  optimizeSvg,
  rewriteRefs,
  minifyCss,
  minifyInlineScripts,
  prunePagefindWasm,
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
    // SVGO rewrites <rect> to <path>. A fill scoped to `rect` silently stops
    // matching and the artwork renders black. This happened in production.
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
