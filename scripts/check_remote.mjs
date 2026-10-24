#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { findFiles } from './lib/fswalk.mjs';
import { attrsOf, htmlPages, openTags, report, runMain } from './lib/gates.mjs';
import { SITE } from './lib/site.mjs';
import { cssUrls } from './check_links.mjs';

const OWN_HOST = new URL(SITE).host;
const REMOTE = /^(?:[a-z][a-z0-9+.-]*:)?\/\/([^/?#\s]+)/i;
const CSS_IMPORT = /@import\s+(?:url\(\s*)?(?:"([^"]*)"|'([^']*)'|([^"'\s);]+))/gi;
const LOADING_REL = new Set([
  'stylesheet',
  'preload',
  'modulepreload',
  'prefetch',
  'prerender',
  'preconnect',
  'dns-prefetch',
  'icon',
  'shortcut',
  'apple-touch-icon',
  'apple-touch-icon-precomposed',
  'mask-icon',
  'manifest',
]);
const SVG_LOADERS = new Set(['image', 'use', 'feimage', 'script']);
const LOADING_ATTRS = new Set(['src', 'poster', 'data', 'background']);
const SRCSET_ATTRS = new Set(['srcset', 'imagesrcset']);

const unescape = (s) =>
  s
    .replace(/&amp;/gi, '&')
    .replace(/&#x2f;/gi, '/')
    .replace(/&#47;/g, '/');

export function foreignHost(url) {
  const m = REMOTE.exec(unescape(url).trim());
  return m && m[1].toLowerCase() !== OWN_HOST ? m[1].toLowerCase() : null;
}

export function* cssImports(css) {
  for (const m of css.matchAll(CSS_IMPORT)) yield m[1] ?? m[2] ?? m[3];
}

export function cssLoads(css) {
  return [...new Set([...cssUrls(css), ...cssImports(css)])];
}

export function loadedUrls(html) {
  const bare = html.replace(/<!--[\s\S]*?-->/g, '');
  const out = [];
  for (const { name, text } of openTags(bare)) {
    const attrs = attrsOf(text);
    const rel = (attrs.get('rel') ?? '').toLowerCase().split(/\s+/);
    for (const [attr, value] of attrs) {
      if (LOADING_ATTRS.has(attr)) out.push([`<${name} ${attr}>`, value]);
      else if (SRCSET_ATTRS.has(attr)) {
        for (const c of value.split(',')) out.push([`<${name} ${attr}>`, c.trim().split(/\s+/)[0]]);
      } else if (attr === 'style') {
        for (const u of cssLoads(unescape(value))) out.push([`<${name} style>`, u]);
      } else if (
        (attr === 'href' || attr === 'xlink:href') &&
        ((name === 'link' && rel.some((r) => LOADING_REL.has(r))) || SVG_LOADERS.has(name))
      ) {
        out.push([`<${name} rel="${rel.join(' ')}" ${attr}>`.replace(' rel=""', ''), value]);
      }
    }
  }
  for (const m of bare.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    for (const u of cssLoads(m[1])) out.push(['<style>', u]);
  }
  return out.filter(([, url]) => url);
}

export function remoteLoads(html) {
  return loadedUrls(html)
    .filter(([, url]) => foreignHost(url))
    .map(([ctx, url]) => `${ctx}: ${url}`);
}

async function main(distDir = 'dist') {
  const problems = [];
  let pages = 0;
  for await (const { path, html } of htmlPages(distDir)) {
    pages += 1;
    for (const line of remoteLoads(html)) problems.push(`${path}: ${line}`);
  }
  for (const path of await findFiles(distDir, /\.css$/)) {
    for (const url of cssLoads(await readFile(path, 'utf8'))) {
      if (foreignHost(url)) problems.push(`${path}: CSS loads ${url}`);
    }
  }
  report(
    'built output loads content from another origin',
    problems,
    `ok: ${pages} page(s) and every stylesheet load only from this site`,
    50,
  );
}

await runMain(import.meta.url, main);
