#!/usr/bin/env node
// Give every large image a blurhash placeholder so its box is filled with its
// own colors while it loads. Over built HTML, not in a component: heroes, body
// images, embed media and card images are all just <img> tags by then.
// The hero is skipped; PostLayout already gives it a placeholder and a fade.
import { createRequire } from 'node:module';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { walk } from './lib/fswalk.mjs';
import { blurhashCss } from './blurhash.mjs';

const toCss = (style) =>
  Object.entries(style)
    .map(([k, v]) => `${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}:${v}`)
    .join(';');

const require = createRequire(import.meta.url);
const sharp = require('sharp');

const MIN_RENDERED_WIDTH = 320;

const VIDEO_POSTER =
  /<lite-(youtube|vimeo)\b[^>]*\bstyle="[^"]*background-image:\s*url\(['"]?(\/[^'")]+)['"]?\)[^"]*"[^>]*>[\s\S]*?<\/lite-\1>/g;

const FADE_SCRIPT_SRC = '/js/image-fade.js';
const FADE_SCRIPT_TAG = `<script src="${FADE_SCRIPT_SRC}" defer></script>`;

const attr = (tag, name) => new RegExp(`\\s${name}="([^"]*)"`, 'i').exec(tag)?.[1];

function localFile(distDir, src) {
  if (!src || /^(https?:)?\/\//.test(src) || src.startsWith('data:')) return null;
  return join(distDir, src.split('?')[0].replace(/^\//, ''));
}

export async function addBlurhash(distDir = 'dist') {
  const files = [];
  for await (const path of walk(distDir)) {
    if (path.endsWith('.html')) files.push(path);
  }

  const cache = new Map();
  const dims = new Map();
  let wrapped = 0;
  let skipped = 0;
  let eagered = 0;
  const pages = new Set();

  for (const page of files) {
    const html = await readFile(page, 'utf8');
    const tags = html.match(/<img\b[^>]*>/gi) ?? [];
    let out = html;
    let placed = 0; // this page only; gates the fade script below

    for (const tag of tags) {
      if (/class="[^"]*\bpost__hero\b/.test(tag)) continue;

      const file = localFile(distDir, attr(tag, 'src'));
      if (!file) continue;

      let style = cache.get(file);
      if (style === undefined) {
        try {
          const meta = await sharp(file).metadata();
          const declared = Number(attr(tag, 'width'));
          const rendered = Number.isFinite(declared) && declared > 0 ? declared : (meta.width ?? 0);
          style = rendered >= MIN_RENDERED_WIDTH ? toCss(await blurhashCss(file)) : null;
          if (meta.width && meta.height) {
            dims.set(file, { w: meta.width, h: meta.height });
          }
        } catch {
          style = null; // not an image sharp can read; leave the tag alone
        }
        cache.set(file, style);
      }
      if (!style) {
        skipped++;
        if (dims.has(file)) {
          const d = dims.get(file);
          let eager = tag;
          if (!attr(tag, 'width') && !attr(tag, 'height')) {
            eager = eager.replace(/<img\b/i, `<img width="${d.w}" height="${d.h}"`);
          }
          eager = eager
            .replace(/\sloading="[^"]*"/i, '')
            .replace(/\sdecoding="[^"]*"/i, '')
            .replace(/<img\b/i, '<img loading="eager" decoding="sync"');
          if (eager !== tag) {
            out = out.split(tag).join(eager);
            eagered++;
          }
        }
        continue;
      }

      const isCard = /class="[^"]*\bsocial__card-img\b/.test(tag);
      const cls = isCard ? 'ph ph--glow' : 'ph';
      let sized = tag;
      if (!attr(tag, 'width') && !attr(tag, 'height')) {
        const d = dims.get(file);
        if (d) sized = tag.replace(/<img\b/i, `<img width="${d.w}" height="${d.h}"`);
      }
      // decoding=sync so the placeholder-to-image swap lands in one paint; async
      // leaves a frame gap that reads as a pop no fade logic can hide.
      sized = sized.replace(/\sdecoding="[^"]*"/i, '').replace(/<img\b/i, '<img decoding="sync"');

      const replacement = `<span class="${cls}"><i class="ph__b" style="${style.replace(/"/g, '&quot;')}" aria-hidden="true"></i>${sized}</span>`;
      out = out.split(tag).join(replacement);
      wrapped++;
      placed++;
    }

    for (const m of [...out.matchAll(VIDEO_POSTER)]) {
      const element = m[0];
      const file = localFile(distDir, m[2]);
      if (!file) continue;

      let style = cache.get(file);
      if (style === undefined) {
        try {
          style = toCss(await blurhashCss(file));
        } catch {
          style = null;
        }
        cache.set(file, style);
      }
      if (!style) continue;

      out = out
        .split(element)
        .join(
          `<span class="ph ph--video"><i class="ph__b" style="${style.replace(/"/g, '&quot;')}" aria-hidden="true"></i>${element}</span>`,
        );
      placed++;
      wrapped++;
    }

    if (out !== html) {
      if ((placed > 0 || /\bhero-blur\b/.test(out)) && !out.includes(FADE_SCRIPT_SRC)) {
        out = out.replace('</head>', `${FADE_SCRIPT_TAG}</head>`);
      }
      await writeFile(page, out);
      pages.add(page);
    }
  }

  const hashed = [...cache.values()].filter(Boolean).length;
  console.log(
    `blurhash: ${hashed} image(s) hashed, ${wrapped} placement(s) across ${pages.size} page(s)` +
      `, ${skipped} below ${MIN_RENDERED_WIDTH}px skipped (${eagered} made eager)`,
  );
  return { hashed, wrapped, skipped, eagered };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await addBlurhash(process.argv[2] ?? 'dist');
}
