#!/usr/bin/env node
import { join } from 'node:path';
import sharp from 'sharp';
import { openTags } from './lib/gates.mjs';
import { attr, rewritePages } from './lib/html.mjs';
import { isMain } from './lib/main.mjs';
import { placeholderStyle } from './placeholder.mjs';

const toCss = (style) =>
  Object.entries(style)
    .map(([k, v]) => `${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}:${v}`)
    .join(';');

const MIN_RENDERED_WIDTH = 320;
const TRANSPARENT = '';

const PICTURE = /<picture\b[^>]*>[\s\S]*?<\/picture>/g;
const VIDEO_POSTER =
  /<lite-(youtube|vimeo)\b[^>]*\bstyle="[^"]*background-image:\s*url\(['"]?(\/[^'")]+)['"]?\)[^"]*"[^>]*>[\s\S]*?<\/lite-\1>/g;

const PLACEHOLDER_END = 'aria-hidden="true"></i>';

const placeholder = (cls, css) =>
  `<span class="${cls}"><i class="ph__b" style="${css.replace(/"/g, '&quot;')}" ${PLACEHOLDER_END}`;

function splice(html, edits) {
  let out = '';
  let pos = 0;
  let wraps = 0;
  for (const { start, end, text, wrap } of edits) {
    out += html.slice(pos, start);
    if (wrap && !out.endsWith(PLACEHOLDER_END)) {
      out += `${placeholder(wrap.cls, wrap.css)}${text}</span>`;
      wraps += 1;
    } else out += text;
    pos = end;
  }
  return [out + html.slice(pos), wraps];
}

function localFile(distDir, src) {
  if (!src || /^(https?:)?\/\//.test(src) || src.startsWith('data:')) return null;
  let path = src.split('?')[0].replace(/^\//, '');
  try {
    path = decodeURIComponent(path);
  } catch {
  }
  return join(distDir, path);
}

function* imgTags(html) {
  let pos = 0;
  for (const { name, text } of openTags(html)) {
    const start = html.indexOf(text, pos);
    pos = start + text.length;
    if (name === 'img') yield { start, end: pos, text };
  }
}

export default async function addPlaceholders(distDir = 'dist') {
  const sizes = new Map();
  const styles = new Map();
  const sizeOf = async (file) => {
    if (!sizes.has(file)) {
      const m = await sharp(file)
        .metadata()
        .catch(() => null);
      sizes.set(file, m?.width && m?.height ? { w: m.width, h: m.height } : null);
    }
    return sizes.get(file);
  };
  const styleOf = async (file) => {
    if (!styles.has(file)) {
      try {
        const ph = await placeholderStyle(file);
        styles.set(file, ph ? toCss(ph) : TRANSPARENT);
      } catch {
        styles.set(file, null);
      }
    }
    return styles.get(file);
  };

  let wrapped = 0;
  let skipped = 0;
  let eagered = 0;
  let transparent = 0;

  async function planImg(tag) {
    if (/class="[^"]*\bpost__hero\b/.test(tag)) return null;
    const file = localFile(distDir, attr(tag, 'src'));
    const size = file && (await sizeOf(file));
    if (!size) return null;
    const unsized = !attr(tag, 'width') && !attr(tag, 'height');
    const sized = unsized
      ? tag.replace(/<img\b/i, `<img width="${size.w}" height="${size.h}"`)
      : tag;
    const declared = Number(attr(tag, 'width'));
    const rendered = declared > 0 ? declared : size.w;

    if (rendered < MIN_RENDERED_WIDTH) {
      skipped++;
      const eager = sized
        .replace(/\sloading="[^"]*"/i, '')
        .replace(/\sdecoding="[^"]*"/i, '')
        .replace(/<img\b/i, '<img loading="eager" decoding="sync"');
      if (eager !== tag) eagered++;
      return { text: eager };
    }
    const css = await styleOf(file);
    if (css === TRANSPARENT) {
      transparent++;
      return null;
    }
    if (css === null) return null;
    const text = sized
      .replace(/\sdecoding="[^"]*"/i, '')
      .replace(/<img\b/i, '<img decoding="sync"');
    const cls = /class="[^"]*\bsocial__card-img\b/.test(tag) ? 'ph ph--glow' : 'ph';
    return { text, wrap: { cls, css } };
  }

  const pages = await rewritePages(distDir, async (html) => {
    const edits = [];
    const pictures = [];
    for (const m of html.matchAll(PICTURE)) {
      const start = m.index;
      const end = start + m[0].length;
      pictures.push([start, end]);
      const img = imgTags(m[0]).next().value;
      const plan = img && (await planImg(img.text));
      if (!plan) continue;
      const text = m[0].slice(0, img.start) + plan.text + m[0].slice(img.end);
      edits.push({ start, end, text, wrap: plan.wrap });
    }
    for (const img of imgTags(html)) {
      if (pictures.some(([from, to]) => img.start >= from && img.start < to)) continue;
      const plan = await planImg(img.text);
      if (plan) edits.push({ start: img.start, end: img.end, ...plan });
    }
    let [out, wraps] = splice(
      html,
      edits.sort((a, b) => a.start - b.start),
    );
    wrapped += wraps;

    const posters = [];
    for (const m of out.matchAll(VIDEO_POSTER)) {
      const file = localFile(distDir, m[2]);
      const css = file && (await styleOf(file));
      if (!css) continue;
      posters.push({
        start: m.index,
        end: m.index + m[0].length,
        text: m[0],
        wrap: { cls: 'ph ph--video', css },
      });
    }
    [out, wraps] = splice(out, posters);
    wrapped += wraps;
    return out;
  });

  const hashed = [...styles.values()].filter(Boolean).length;
  console.log(
    `placeholders: ${hashed} image(s), ${wrapped} placement(s) across ${pages} page(s)` +
      `, ${skipped} below ${MIN_RENDERED_WIDTH}px skipped (${eagered} made eager)` +
      `, ${transparent} with transparency left without`,
  );
  return { hashed, wrapped, skipped, eagered, transparent };
}

if (isMain(import.meta.url)) {
  await addPlaceholders(process.argv[2] ?? 'dist');
}
