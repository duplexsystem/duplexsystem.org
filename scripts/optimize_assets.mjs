#!/usr/bin/env node
import { readFile, writeFile, stat, unlink, rename } from 'node:fs/promises';
import { join, extname, dirname } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { optimize } from 'svgo';
import { transform } from 'lightningcss';
import { transform as esbuildTransform } from 'esbuild';
import { cached } from './lib/cache.mjs';
import { walk, posixRel } from './lib/fswalk.mjs';
import { hash8, sha256 } from './lib/hash.mjs';
import { dropSubtree, swap } from './lib/html.mjs';
import { isMain } from './lib/main.mjs';
import { mapPool } from './lib/pool.mjs';
import { SITE } from './lib/site.mjs';

const run = promisify(execFile);

const WEBP = { quality: 82, effort: 6 };

export function classify(path, distDir) {
  switch (extname(path).toLowerCase()) {
    case '.jpg':
    case '.jpeg':
      return 'to-webp';
    case '.gif':
      return 'gif-to-webp';
    case '.png':
      return 'png-lossless';
    case '.svg':
      return 'svg';
    case '.js':
      return (distDir ? posixRel(distDir, dirname(path)) : dirname(path))
        .split(/[\\/]/)
        .includes('js')
        ? 'js'
        : 'skip';
    default:
      return 'skip';
  }
}

const AROUND = [
  ['"', '"'],
  ["'", "'"],
  ['(', ')'],
  ['"', ' '],
  [', ', ' '],
  ['"', '\\"'],
  ['&quot;', '&quot;'],
  ['&quot;', ' '],
];

export function rewriteRefs(source, mapping) {
  let out = source;
  for (const [path, to] of mapping) {
    for (const prefix of ['', SITE]) {
      for (const [open, close] of AROUND) {
        out = out.split(open + prefix + path + close).join(open + prefix + to + close);
      }
    }
  }
  return out;
}

const SVGO_CONFIG = {
  multipass: true,
  floatPrecision: 2,
  plugins: [
    {
      name: 'preset-default',
      params: {
        overrides: {
          inlineStyles: false,
          minifyStyles: { usage: false },
          cleanupIds: false,
          collapseGroups: false,
          removeUselessDefs: false,
          removeHiddenElems: false,
          removeUnknownsAndDefaults: false,
        },
      },
    },
  ],
};

export function optimizeSvg(source) {
  try {
    const { data } = optimize(source, SVGO_CONFIG);
    return data.length <= source.length ? data : source;
  } catch {
    return source;
  }
}

export function minifyCss(css, filename = 'style.css') {
  try {
    const { code } = transform({ filename, code: Buffer.from(css), minify: true });
    const out = code.toString();
    return out.length <= css.length ? out : css;
  } catch {
    return css;
  }
}

const BLOCKING_SHEET = /<link blocking="render"[^>]*\brel="stylesheet"/;

export function markStylesheetBlocking(html) {
  return html.replace(
    /<link\b(?![^>]*\bblocking=)([^>]*\brel="stylesheet"[^>]*\bhref="\/_astro\/[^"]+\.css"[^>]*)>/g,
    '<link blocking="render"$1>',
  );
}

const PRELOAD_SCRIPTS = new Set(['/js/crack-email.js', '/pagefind/pagefind-component-ui.js']);

const visible = (html) => dropSubtree(html, /<div[^>]*class="[^"]*nojs-only[^"]*"[^>]*>/g, 'div');

const CONDITIONAL_FONTS = [
  {
    family: /^JetBrains Mono/,
    when: (html) => /<pre\b/.test(visible(html)),
    face: (f, html) =>
      (f.weight !== '700' || /font-weight:\s*bold/.test(html)) &&
      (f.style !== 'italic' || /class="t-cm"/.test(html)),
  },
  { family: /^Noto Emoji/, when: (html) => /class="emoji"/.test(html) },
  { family: /^KaTeX_/, when: (html) => /class="katex/.test(html) },
];

export function fontFaces(css) {
  const faces = [];
  for (const [, body] of css.matchAll(/@font-face\{([^}]*)\}/g)) {
    const url = /src:\s*url\(([^)]+?)\)/.exec(body)?.[1]?.replace(/^["']|["']$/g, '');
    if (!url) continue;
    const range = /unicode-range:\s*([^;]+)/.exec(body)?.[1];
    faces.push({
      family: /font-family:\s*"?([^;"]+)"?/.exec(body)?.[1]?.trim() ?? '',
      weight: /font-weight:\s*([^;]+)/.exec(body)?.[1]?.trim() ?? '400',
      style: /font-style:\s*([^;]+)/.exec(body)?.[1]?.trim() ?? 'normal',
      coversAscii: !range || coversLetter(range),
      url,
    });
  }
  return faces;
}

function coversLetter(range) {
  return range.split(',').some((part) => {
    const t = part.trim().replace(/^U\+/i, '');
    const [lo, hi = lo] = t.includes('?')
      ? [t.replace(/\?/g, '0'), t.replace(/\?/g, 'F')]
      : t.split('-');
    return parseInt(lo, 16) <= 0x41 && 0x41 <= parseInt(hi, 16);
  });
}

function isExtSibling(f, faces) {
  return (
    !f.coversAscii &&
    faces.some(
      (g) => g.coversAscii && g.family === f.family && g.weight === f.weight && g.style === f.style,
    )
  );
}

export function hoistCriticalLinks(html, faces = []) {
  const sheet = /<link\b[^>]*\brel="stylesheet"[^>]*\bhref="\/_astro\/[^"]+\.css"[^>]*>/.exec(html);
  if (!sheet) return html;

  const seen = new Set();
  const hints = [];
  for (const m of html.matchAll(/<script\b([^>]*)\bsrc="(\/[^"]+)"([^>]*)>/g)) {
    const attrs = `${m[1]} ${m[3]}`;
    const href = m[2];
    if (!PRELOAD_SCRIPTS.has(href) || seen.has(href)) continue;
    seen.add(href);
    hints.push(
      /\btype="module"/.test(attrs)
        ? `<link rel="modulepreload" href="${href}">`
        : `<link rel="preload" href="${href}" as="script">`,
    );
  }

  let out = swap(html, sheet[0], '');
  const block = sheet[0] + hints.join('');
  const firstPreload = /<link\b[^>]*\brel="preload"[^>]*>/.exec(out);
  out = firstPreload
    ? swap(out, firstPreload[0], block + firstPreload[0])
    : swap(out, '</head>', `${block}</head>`);

  const fonts = faces
    .filter((f) => !f.url.startsWith('data:'))
    .filter((f) => !isExtSibling(f, faces))
    .filter((f) =>
      CONDITIONAL_FONTS.some(
        (r) => r.family.test(f.family) && r.when(html) && (r.face?.(f, html) ?? true),
      ),
    )
    .filter((f) => !out.includes(`href="${f.url}"`))
    .map((f) => `<link rel="preload" href="${f.url}" as="font" type="font/woff2" crossorigin>`);
  if (fonts.length) {
    const all = [...out.matchAll(/<link\b[^>]*\brel="preload"[^>]*\bas="font"[^>]*>/g)];
    const last = all.at(-1);
    out = last
      ? swap(out, last[0], last[0] + fonts.join(''))
      : swap(out, '</head>', `${fonts.join('')}</head>`);
  }
  return out;
}

export async function minifyInlineScripts(html) {
  const blocks = [...html.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/g)];
  let out = html;
  for (const [full, attrs, body] of blocks) {
    if (!body.trim()) continue;
    if (/\btype\s*=\s*["'](?!module|text\/javascript|application\/javascript)/.test(attrs))
      continue;
    try {
      const { code } = await esbuildTransform(body, {
        minify: true,
        loader: 'js',
        legalComments: 'inline',
      });
      out = swap(out, full, `<script${attrs}>${code.trim()}</script>`);
    } catch {
    }
  }
  return out;
}

const PAGEFIND_UNUSED = [
  'pagefind-ui.js',
  'pagefind-ui.css',
  'pagefind-modular-ui.js',
  'pagefind-modular-ui.css',
  'pagefind-highlight.js',
];

export async function prunePagefindWasm(distDir) {
  const entryPath = join(distDir, 'pagefind', 'pagefind-entry.json');
  let entry;
  try {
    entry = JSON.parse(await readFile(entryPath, 'utf8'));
  } catch {
    return 0;
  }

  const languages = Object.values(entry.languages ?? {});
  if (languages.length === 0 || languages.some((l) => !l.wasm)) return 0;

  const path = join(distDir, 'pagefind', 'wasm.unknown.pagefind');
  try {
    const size = (await stat(path)).size;
    await unlink(path);
    return size;
  } catch {
    return 0;
  }
}

export async function prunePagefind(distDir) {
  let saved = 0;
  for (const name of PAGEFIND_UNUSED) {
    const path = join(distDir, 'pagefind', name);
    try {
      saved += (await stat(path)).size;
      await unlink(path);
    } catch {
    }
  }
  saved += await prunePagefindWasm(distDir);
  return saved;
}

const OPTIPNG_CACHE = '.cache/optipng';

async function optimizePng(path) {
  const input = await readFile(path);
  let out;
  let inPlace = false;
  try {
    out = await cached(
      OPTIPNG_CACHE,
      `${sha256(input, 'optipng -o7 -strip all')}.png`,
      async () => {
        await run('optipng', ['-quiet', '-o7', '-strip', 'all', path]);
        inPlace = true;
        return readFile(path);
      },
    );
  } catch (e) {
    if (e.code !== 'ENOENT') console.warn(`optipng failed on ${path}: ${e.message.split('\n')[0]}`);
    return 0;
  }
  if (!inPlace && out.length < input.length) await writeFile(path, out);
  return Math.max(0, input.length - out.length);
}

const siteUrl = (distDir, path) => `/${posixRel(distDir, path)}`;

const VITE_HASHED = /^(.+)\.[A-Za-z0-9_-]{8}\.svg$/;
async function rehashSvg(path, bytes, distDir) {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const m = VITE_HASHED.exec(name);
  if (!m || !path.includes('/_astro/')) return null;
  const to = join(dirname(path), `${m[1]}.${hash8(bytes)}.svg`);
  if (to === path) return null;
  await rename(path, to);
  return { from: siteUrl(distDir, path), to: siteUrl(distDir, to) };
}

async function convertToWebp(path, distDir) {
  const buf = await readFile(path);
  const out = await sharp(buf).rotate().webp(WEBP).toBuffer();
  const before = buf.length;
  if (out.length >= before) return null;

  const webpPath = path.replace(/\.(jpe?g)$/i, '.webp');
  await writeFile(webpPath, out);
  await unlink(path);
  return {
    from: siteUrl(distDir, path),
    to: siteUrl(distDir, webpPath),
    saved: before - out.length,
  };
}

export function isPixelArt({ width = 0, height = 0, pageHeight = height }) {
  return width > 0 && width <= 128 && pageHeight <= 128;
}

async function convertGifToWebp(path, distDir) {
  const buf = await readFile(path);
  const before = buf.length;

  const meta = await sharp(buf, { animated: true }).metadata();
  const webp = isPixelArt(meta) ? { lossless: true, effort: 6 } : { quality: 80, effort: 6 };
  const out = await sharp(buf, { animated: true }).webp(webp).toBuffer();

  const srcFrames = meta.pages ?? 1;
  const outFrames = (await sharp(out, { animated: true }).metadata()).pages ?? 1;
  if (outFrames < srcFrames) {
    throw new Error(
      `${path}: animation lost converting to WebP (${srcFrames} frames in, ${outFrames} out)`,
    );
  }

  const webpPath = path.replace(/\.gif$/i, '.webp');
  await writeFile(webpPath, out);
  if (srcFrames > 1) {
    const still = await sharp(buf).webp(webp).toBuffer();
    await writeFile(path.replace(/\.gif$/i, '.still.webp'), still);
  }
  await unlink(path);
  return {
    from: siteUrl(distDir, path),
    to: siteUrl(distDir, webpPath),
    saved: before - out.length,
  };
}

export default async function optimizeAssets(distDir = 'dist') {
  const stats = {
    svgSaved: 0,
    pngSaved: 0,
    webpSaved: 0,
    converted: 0,
    gifSaved: 0,
    gifConverted: 0,
    cssSaved: 0,
    inlineJsSaved: 0,
    pagefindPruned: 0,
  };

  stats.pagefindPruned = await prunePagefind(distDir);

  const all = [];
  for await (const p of walk(distDir)) all.push(p);

  const renames = await mapPool(all, async (path) => {
    switch (classify(path, distDir)) {
      case 'svg': {
        const src = await readFile(path, 'utf8');
        const out = optimizeSvg(src);
        if (out.length < src.length) {
          await writeFile(path, out);
          stats.svgSaved += src.length - out.length;
        }
        return rehashSvg(path, out.length < src.length ? out : src, distDir);
      }
      case 'js': {
        const src = await readFile(path, 'utf8');
        const { code } = await esbuildTransform(src, {
          minify: true,
          loader: 'js',
          legalComments: 'inline',
        });
        if (code.length < src.length) {
          await writeFile(path, code);
          stats.inlineJsSaved += src.length - code.length;
        }
        return null;
      }
      case 'png-lossless':
        stats.pngSaved += await optimizePng(path);
        return null;
      case 'to-webp': {
        const res = await convertToWebp(path, distDir);
        if (res) {
          stats.webpSaved += res.saved;
          stats.converted += 1;
        }
        return res;
      }
      case 'gif-to-webp': {
        const res = await convertGifToWebp(path, distDir);
        if (res) {
          stats.gifSaved += res.saved;
          stats.gifConverted += 1;
        }
        return res;
      }
      default:
        return null;
    }
  });
  const mapping = new Map(renames.filter(Boolean).map((r) => [r.from, r.to]));

  const faces = [];
  for (const path of all) {
    if (path.endsWith('.css')) faces.push(...fontFaces(await readFile(path, 'utf8')));
  }

  await mapPool(
    all.filter((path) => /\.(html|css|xml|txt|json)$/i.test(path)),
    async (path) => {
      const src = await readFile(path, 'utf8');
      let out = mapping.size > 0 ? rewriteRefs(src, mapping) : src;
      if (path.endsWith('.css') && out.includes('\n')) {
        const minified = minifyCss(out, path);
        stats.cssSaved += out.length - minified.length;
        out = minified;
      }
      if (path.endsWith('.html')) {
        if (!BLOCKING_SHEET.test(out)) {
          out = markStylesheetBlocking(out);
          out = hoistCriticalLinks(out, faces);
        }
        const minified = await minifyInlineScripts(out);
        stats.inlineJsSaved += out.length - minified.length;
        out = minified;
      }
      if (out !== src) await writeFile(path, out);
    },
  );

  const kb = (n) => (n / 1024).toFixed(1);
  console.log(
    `optimized assets: svg -${kb(stats.svgSaved)} kB, png -${kb(stats.pngSaved)} kB, ` +
      `${stats.converted} jpeg->webp -${kb(stats.webpSaved)} kB, ` +
      `${stats.gifConverted} gif->webp -${kb(stats.gifSaved)} kB, css -${kb(stats.cssSaved)} kB, ` +
      `inline js -${kb(stats.inlineJsSaved)} kB, pagefind pruned -${kb(stats.pagefindPruned)} kB`,
  );
  return stats;
}

if (isMain(import.meta.url)) {
  await optimizeAssets(process.argv[2]);
}
