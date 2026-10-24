import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { walk, posixRel } from './fswalk.mjs';
import { attr } from './html.mjs';
import { SITE } from './site.mjs';

export const ELIGIBLE = /^(?:_astro\/[^/]+|buttons\/[^/]+\.[0-9a-f]{8})\.(?:png|gif|jpe?g|webp)$/i;

export function sitePath(value) {
  if (!value) return null;
  let v = value.trim();
  if (v.startsWith(SITE)) v = v.slice(SITE.length);
  if (!v.startsWith('/') || v.startsWith('//')) return null;
  return v.split(/[?#]/)[0].replace(/^\//, '');
}

export function protectedInHtml(html) {
  const out = new Set();
  for (const [tag] of html.matchAll(/<link\b[^>]*>/gi)) {
    const rel = (attr(tag, 'rel') ?? '').toLowerCase().split(/\s+/);
    if (
      rel.some(
        (r) => r === 'icon' || r === 'apple-touch-icon' || r === 'mask-icon' || r === 'shortcut',
      )
    ) {
      const p = sitePath(attr(tag, 'href'));
      if (p) out.add(p);
    }
  }
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
    const key = (attr(tag, 'property') ?? attr(tag, 'name') ?? '').toLowerCase();
    if (/^(og:image(:url|:secure_url)?|twitter:image(:src)?)$/.test(key)) {
      const p = sitePath(attr(tag, 'content'));
      if (p) out.add(p);
    }
  }
  return out;
}

export function protectedInManifest(json) {
  const out = new Set();
  try {
    for (const icon of JSON.parse(json).icons ?? []) {
      const p = sitePath(icon.src);
      if (p) out.add(p);
    }
  } catch {
  }
  return out;
}

export function wellKnownButton(mapsConf) {
  const m = /map\s+[^{]*\$wk_button\s*\{[^}]*?\bdefault\s+(\/\S+?);/s.exec(mapsConf);
  return m ? m[1].replace(/^\//, '') : null;
}

export async function protectedPaths(distDir, repoDir = '.') {
  const out = new Set([
    'favicon.ico',
    'favicon.svg',
    'apple-touch-icon.png',
    'manifest.webmanifest',
  ]);
  try {
    const btn = wellKnownButton(await readFile(join(repoDir, 'nginx/maps.conf'), 'utf8'));
    if (btn) out.add(btn);
  } catch {
  }
  for await (const path of walk(distDir)) {
    const rel = posixRel(distDir, path);
    if (rel.endsWith('.html'))
      for (const p of protectedInHtml(await readFile(path, 'utf8'))) out.add(p);
    if (rel.endsWith('.webmanifest'))
      for (const p of protectedInManifest(await readFile(path, 'utf8'))) out.add(p);
  }
  return out;
}
