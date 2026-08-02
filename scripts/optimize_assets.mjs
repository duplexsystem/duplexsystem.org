#!/usr/bin/env node
import { readdir, readFile, writeFile, stat, unlink } from 'node:fs/promises';
import { join, extname, relative, sep } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { walk } from './lib/fswalk.mjs';
import { optimize } from 'svgo';
import { transform } from 'lightningcss';
import { transform as esbuildTransform } from 'esbuild';

const require = createRequire(import.meta.url);
const sharp = require('sharp');
const run = promisify(execFile);

const WEBP = { quality: 82, effort: 6 };

export function classify(path) {
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
      return path.split(sep).includes('js') ? 'js' : 'skip';
    default:
      return 'skip';
  }
}

export function rewriteRefs(source, mapping) {
  let out = source;
  for (const [from, to] of mapping) {
    out = out.split(`"${from}"`).join(`"${to}"`);
    out = out.split(`'${from}'`).join(`'${to}'`);
    out = out.split(`(${from})`).join(`(${to})`);
    out = out.split(`"${from} `).join(`"${to} `);
    out = out.split(`, ${from} `).join(`, ${to} `);
  }
  return out;
}

/** Conservative SVGO config. preset-default alone strips the class names the
 *  error artwork's animation targets and its reduced-motion block, leaving a
 *  valid but dead SVG. Every override below disables a plugin that breaks it.
 *  SVGO v4 moved removeViewBox out of preset-default, so viewBox needs none. */
const SVGO_CONFIG = {
  multipass: true,
  floatPrecision: 2,
  plugins: [
    {
      name: 'preset-default',
      params: {
        overrides: {
          inlineStyles: false, // the <style> block drives the animation
          minifyStyles: { usage: false },
          cleanupIds: false, // clipPath id is referenced by clip-path="url(#…)"
          collapseGroups: false, // animated groups ARE the animation targets
          removeUselessDefs: false, // the clipPath lives in <defs>
          removeHiddenElems: false,
          removeUnknownsAndDefaults: false, // keeps role="img"; costs ~11 bytes
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

export function markStylesheetBlocking(html) {
  return html.replace(
    /<link\b(?![^>]*\bblocking=)([^>]*\brel="stylesheet"[^>]*\bhref="\/_astro\/[^"]+\.css"[^>]*)>/g,
    '<link blocking="render"$1>',
  );
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
        // Keep @license / @license-end markers: LibreJS reads them to verify
        // the page's JavaScript is free. esbuild strips them by default.
        legalComments: 'inline',
      });
      out = out.replace(full, `<script${attrs}>${code.trim()}</script>`);
    } catch {}
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
    return 0; // no entry file: pagefind did not run, nothing to prune
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
      /* absent in this Pagefind version */
    }
  }
  saved += await prunePagefindWasm(distDir);
  return saved;
}

async function optimizePng(path) {
  const before = (await stat(path)).size;
  try {
    await run('optipng', ['-quiet', '-o7', '-strip', 'all', path]);
  } catch {
    return 0; // optipng absent: leave the file alone
  }
  return before - (await stat(path)).size;
}

async function convertToWebp(path, distDir) {
  const buf = await readFile(path);
  const out = await sharp(buf).webp(WEBP).toBuffer();
  const before = buf.length;
  if (out.length >= before) return null; // conversion did not help; keep the original

  const webpPath = path.replace(/\.(jpe?g)$/i, '.webp');
  await writeFile(webpPath, out);
  await unlink(path);

  const url = (p) => '/' + relative(distDir, p).split(sep).join('/');
  return { from: url(path), to: url(webpPath), saved: before - out.length };
}

async function convertGifToWebp(path, distDir) {
  const buf = await readFile(path);
  const before = buf.length;

  const { width = 0, height = 0 } = await sharp(buf, { animated: true }).metadata();
  const isPixelArt = width > 0 && width <= 128 && height <= 128;

  const out = await sharp(buf, { animated: true })
    .webp(isPixelArt ? { lossless: true, effort: 6 } : { quality: 80, effort: 6 })
    .toBuffer();

  const srcFrames = (await sharp(buf, { animated: true }).metadata()).pages ?? 1;
  const outFrames = (await sharp(out, { animated: true }).metadata()).pages ?? 1;
  if (outFrames < srcFrames) {
    throw new Error(
      `${path}: animation lost converting to WebP (${srcFrames} frames in, ${outFrames} out)`,
    );
  }

  const webpPath = path.replace(/\.gif$/i, '.webp');
  await writeFile(webpPath, out);
  await unlink(path);
  const url = (p) => '/' + relative(distDir, p).split(sep).join('/');
  return { from: url(path), to: url(webpPath), saved: before - out.length };
}

export async function optimizeAssets(distDir) {
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

  const mapping = new Map();

  for (const path of all) {
    switch (classify(path)) {
      case 'svg': {
        const src = await readFile(path, 'utf8');
        const out = optimizeSvg(src);
        if (out.length < src.length) {
          await writeFile(path, out);
          stats.svgSaved += src.length - out.length;
        }
        break;
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
        break;
      }
      case 'png':
      case 'png-lossless':
        stats.pngSaved += await optimizePng(path);
        break;
      case 'to-webp': {
        const res = await convertToWebp(path, distDir);
        if (res) {
          mapping.set(res.from, res.to);
          stats.webpSaved += res.saved;
          stats.converted += 1;
        }
        break;
      }
      case 'gif-to-webp': {
        const res = await convertGifToWebp(path, distDir);
        if (res) {
          mapping.set(res.from, res.to);
          stats.gifSaved += res.saved;
          stats.gifConverted += 1;
        }
        break;
      }
    }
  }

  for (const path of all) {
    if (!/\.(html|css|xml|txt|json)$/i.test(path)) continue;
    const src = await readFile(path, 'utf8');
    let out = mapping.size > 0 ? rewriteRefs(src, mapping) : src;
    if (path.endsWith('.css')) {
      const minified = minifyCss(out, path);
      stats.cssSaved += out.length - minified.length;
      out = minified;
    }
    if (path.endsWith('.html')) {
      out = markStylesheetBlocking(out);
      const minified = await minifyInlineScripts(out);
      stats.inlineJsSaved += out.length - minified.length;
      out = minified;
    }
    if (out !== src) await writeFile(path, out);
  }

  return stats;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const s = await optimizeAssets(process.argv[2] ?? 'dist');
  const kb = (n) => (n / 1024).toFixed(1);
  console.log(
    `optimized assets: svg -${kb(s.svgSaved)} kB, png -${kb(s.pngSaved)} kB, ` +
      `${s.converted} jpeg->webp -${kb(s.webpSaved)} kB, ` +
      `${s.gifConverted} gif->webp -${kb(s.gifSaved)} kB, css -${kb(s.cssSaved)} kB, ` +
      `inline js -${kb(s.inlineJsSaved)} kB, pagefind pruned -${kb(s.pagefindPruned)} kB`,
  );
}
