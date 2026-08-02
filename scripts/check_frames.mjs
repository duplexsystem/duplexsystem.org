#!/usr/bin/env node
// Every table, lone body image, chart and embed in a post must carry the .frame
// chrome that rehype/frame.mjs and Chart.astro apply.
// Post pages only: /licenses/ ships an unframed Web Labels table by design.
import { readFile, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { walk } from './lib/fswalk.mjs';

const POST_PAGE = /^blog\/[^/]+\/index\.html$/;

/** Strips .frame--embed figures whole: they hold fetched third-party markup
 *  rehype/frame.mjs never sees, in shadow DOM or light DOM depending on the
 *  embed. Depth-counted because embeds nest figures and templates of their own
 *  and a non-greedy regex closes on the first nested tag. */
export function stripEmbedFigures(html) {
  const TAG = /<figure\b[^>]*>|<\/figure>/g;
  const isEmbedOpen = (tag) => /\bclass="[^"]*\bframe--embed\b[^"]*"/.test(tag);

  let out = '';
  let pos = 0;
  let m;
  while ((m = TAG.exec(html))) {
    if (m[0].startsWith('</') || !isEmbedOpen(m[0])) continue;

    out += html.slice(pos, m.index);
    let depth = 1;
    let inner;
    while (depth > 0 && (inner = TAG.exec(html))) {
      depth += inner[0].startsWith('</') ? -1 : 1;
    }
    pos = TAG.lastIndex;
  }
  out += html.slice(pos);
  return out;
}

export function allTablesFramed(html) {
  const scoped = stripEmbedFigures(html);
  const framed = /<div class="frame__scroll"[^>]*>\s*<table\b[\s\S]*?<\/table>\s*<\/div>/g;
  return !scoped.replace(framed, '').includes('<table');
}

export function noUnframedImages(html) {
  const scoped = stripEmbedFigures(html);
  return !/<p(?:\s[^>]*)?>\s*<img\b[^>]*>\s*<\/p>/.test(scoped);
}

export function noScriptedCharts(html) {
  const charts =
    html.match(/<figure\b[^>]*\bclass="[^"]*\bchart\b[^"]*"[^>]*>[\s\S]*?<\/figure>/g) ?? [];
  return charts.every((fig) => !/<script\b/i.test(fig));
}

export function everyBarHasBody(html) {
  const BAR = /<div\b[^>]*\bclass="[^"]*\bframe__bar\b[^"]*"[^>]*>/g;
  const PAIRED =
    /<div\b[^>]*\bclass="[^"]*\bframe__bar\b[^"]*"[^>]*>[\s\S]*?<\/div>\s*<div\b[^>]*\bclass="[^"]*\bframe__body\b[^"]*"[^>]*>/g;

  const hasAnyFrame = /\bclass="[^"]*\bframe\b[^"]*"/.test(html);
  const bars = html.match(BAR) ?? [];
  if (hasAnyFrame && bars.length === 0) return false;

  const paired = html.match(PAIRED) ?? [];
  return bars.length === paired.length;
}

export function noUnframedEmbeds(html) {
  const EMBED_HOST_TAG = /<[a-z][a-z0-9]*-[a-z0-9]+(?:-[a-z0-9]+)*[\s/>]/;
  return !EMBED_HOST_TAG.test(stripEmbedFigures(html));
}

export function heroNotBlurred(html) {
  const wraps = html.match(/<div\b[^>]*\bclass="[^"]*\bhero-wrap\b[^"]*"[^>]*>/g) ?? [];
  return wraps.every((tag) => !/\bfilter\s*:/.test(tag));
}

const CHECKS = [
  ['a <table> outside .frame__scroll', (html) => !allTablesFramed(html)],
  ['the real hero image is blurred by a filter on .hero-wrap', (html) => !heroNotBlurred(html)],
  ['a lone body <img> escaped framing (<p><img></p> remains)', (html) => !noUnframedImages(html)],
  ['a chart <svg> contains <script>', (html) => !noScriptedCharts(html)],
  ['a .frame__bar has no sibling .frame__body', (html) => !everyBarHasBody(html)],
  ['an astro-embed custom element escaped framing', (html) => !noUnframedEmbeds(html)],
];

async function main(distDir = 'dist') {
  const failures = [];

  for await (const path of walk(distDir)) {
    if (!path.endsWith('.html')) continue;
    const rel = relative(distDir, path).split(sep).join('/');
    if (!POST_PAGE.test(rel)) continue;

    const html = await readFile(path, 'utf8');
    for (const [label, isBroken] of CHECKS) {
      if (isBroken(html)) failures.push(`${path}: ${label}`);
    }
  }

  if (failures.length) {
    console.error('FAIL: unframed content in a post body');
    for (const f of failures) console.error(`  ${f}`);
    process.exit(1);
  }
  console.log('ok: every table, image, chart and embed in a post body is framed');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main(process.argv[2]);
}
