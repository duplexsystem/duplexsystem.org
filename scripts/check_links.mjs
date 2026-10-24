#!/usr/bin/env node
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { findFiles, posixRel } from './lib/fswalk.mjs';
import { REPO_ROOT, attrsOf, htmlPages, openTags, report, runMain } from './lib/gates.mjs';

async function isFile(p) {
  try {
    return (await stat(p)).isFile();
  } catch {
    return false;
  }
}

const EXTERNAL = /^([a-z][a-z0-9+.-]*:|\/\/)/i;
const URL_ATTRS = new Set(['href', 'src', 'poster', 'action']);
const SRCSET_ATTRS = new Set(['srcset', 'imagesrcset']);
const CSS_URL = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^"')\s][^)]*?))\s*\)/g;

export function* cssUrls(css) {
  for (const m of css.matchAll(CSS_URL)) {
    const url = (m[1] ?? m[2] ?? m[3]).trim();
    if (url) yield url;
  }
}

export function extractRefs(html) {
  const refs = [];
  for (const { text } of openTags(html)) {
    for (const [attr, raw] of attrsOf(text)) {
      const value = decodeEntities(raw);
      if (URL_ATTRS.has(attr)) refs.push(value.trim());
      else if (SRCSET_ATTRS.has(attr)) {
        for (const candidate of value.split(',')) refs.push(candidate.trim().split(/\s+/)[0]);
      } else if (attr === 'style') refs.push(...cssUrls(value));
    }
  }
  for (const m of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) refs.push(...cssUrls(m[1]));
  return refs.filter(Boolean);
}

export function anchorsIn(html) {
  const ids = new Set();
  for (const { text } of openTags(html)) {
    const attrs = attrsOf(text);
    for (const key of ['id', 'name']) if (attrs.has(key)) ids.add(decodeEntities(attrs.get(key)));
  }
  return ids;
}

function decodeEntities(s) {
  return s
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&#x27;', "'");
}

function safeDecode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return null;
  }
}

const SERVER_ROUTED = ['/.well-known/button'];
const NGINX_DIR = join(REPO_ROOT, 'nginx');

async function serverRoutes() {
  let conf = '';
  try {
    for (const name of await readdir(NGINX_DIR)) {
      if (name.endsWith('.conf')) conf += await readFile(join(NGINX_DIR, name), 'utf8');
    }
  } catch {
    throw new Error(
      `${NGINX_DIR} is unreadable, so ${SERVER_ROUTED.length} exempt path(s) cannot be verified`,
    );
  }
  const missing = SERVER_ROUTED.filter((route) => !conf.includes(route));
  if (missing.length) {
    throw new Error(`${NGINX_DIR} no longer routes: ${missing.join(', ')}`);
  }
  return new Set(SERVER_ROUTED);
}

export function ownOriginPaths(text, origin) {
  const found = new Set();
  const re = new RegExp(
    `${origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(/[^\\s"'<>\\\\&)]*)`,
    'g',
  );
  for (const m of text.matchAll(re)) found.add(m[1]);
  return [...found];
}

export async function findBroken(distDir = 'dist') {
  const broken = [];
  const routed = await serverRoutes();
  const anchors = new Map();
  const anchorsOf = async (file) => {
    if (!anchors.has(file)) anchors.set(file, anchorsIn(await readFile(file, 'utf8')));
    return anchors.get(file);
  };
  const fileExists = new Map();
  const exists = (path) => {
    if (!fileExists.has(path)) fileExists.set(path, isFile(path));
    return fileExists.get(path);
  };

  async function problemWith(from, ref, { fragments = true } = {}) {
    const [beforeHash, rawFragment] = ref.split('#', 2);
    const rawPath = beforeHash.split('?')[0];
    const path = safeDecode(rawPath);
    const fragment = rawFragment === undefined ? '' : safeDecode(rawFragment);
    if (path === null || fragment === null) return 'malformed %-escape';

    let target = from;
    if (path) {
      if (!path.startsWith('/')) {
        return 'relative URL';
      }
      if (routed.has(path.replace(/\/$/, ''))) return null;
      const candidates = path.endsWith('/')
        ? [join(distDir, path, 'index.html')]
        : [join(distDir, path), join(distDir, `${path}.html`), join(distDir, path, 'index.html')];
      target = null;
      for (const c of candidates) {
        if (await exists(c)) {
          target = c;
          break;
        }
      }
      if (!target) return '';
    }

    if (fragments && fragment && fragment !== 'top' && target.endsWith('.html')) {
      if (!(await anchorsOf(target)).has(fragment)) return `no element with id "${fragment}"`;
    }
    return null;
  }

  const note = (from, ref, why) => broken.push(`${from} -> ${ref}${why ? ` (${why})` : ''}`);

  const origin = await siteOrigin(distDir);
  for await (const { path: page, html } of htmlPages(distDir)) {
    for (const ref of extractRefs(html)) {
      const own = origin && ref.startsWith(`${origin}/`) ? ref.slice(origin.length) : null;
      if (own === null && EXTERNAL.test(ref)) continue;
      const why = await problemWith(page, own ?? ref);
      if (why !== null) note(page, ref, why);
    }
  }

  for (const css of await findFiles(distDir, /\.css$/)) {
    for (const ref of cssUrls(await readFile(css, 'utf8'))) {
      if (EXTERNAL.test(ref)) continue;
      const why = await problemWith(css, ref, { fragments: false });
      if (why !== null) note(css, ref, why);
    }
  }

  for (const feed of await findFiles(distDir, /\.(?:xml|json|webmanifest)$/)) {
    const text = await readFile(feed, 'utf8');
    const refs = origin ? ownOriginPaths(text, origin) : [];
    if (feed.endsWith('.webmanifest')) {
      for (const m of text.matchAll(/"src"\s*:\s*"(\/[^"]*)"/g)) refs.push(m[1]);
    }
    for (const ref of refs) {
      const why = await problemWith(feed, ref, { fragments: false });
      if (why !== null) note(posixRel(distDir, feed), ref, why);
    }
  }
  return broken;
}

async function siteOrigin(distDir) {
  try {
    const html = await readFile(join(distDir, 'index.html'), 'utf8');
    for (const { name, text } of openTags(html)) {
      const attrs = attrsOf(text);
      if (name === 'link' && attrs.get('rel') === 'canonical')
        return new URL(attrs.get('href')).origin;
    }
  } catch {
  }
  return null;
}

async function main(distDir = 'dist') {
  report(
    'broken internal links',
    await findBroken(distDir),
    'ok: no broken internal links, images, CSS urls, feed entries or fragment targets',
  );
}

await runMain(import.meta.url, main);
