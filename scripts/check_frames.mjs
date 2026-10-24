#!/usr/bin/env node
import { htmlPages, report, runMain, stripEmbedFigures } from './lib/gates.mjs';

const POST_PAGE = /^blog\/[^/]+\/index\.html$/;

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

  const BARLESS_TABLE =
    /<figure\b[^>]*\bclass="[^"]*\bframe\b[^"]*"[^>]*>\s*<div\b[^>]*\bclass="[^"]*\bframe__body\b[^"]*"[^>]*>\s*<div\b[^>]*\bclass="[^"]*\bframe__scroll\b/g;
  const hasAnyFrame = /\bclass="[^"]*\bframe\b[^"]*"/.test(html.replace(BARLESS_TABLE, ''));
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

  for await (const { path, html } of htmlPages(
    distDir,
    (rel) => POST_PAGE.test(rel),
    'post pages',
  )) {
    for (const [label, isBroken] of CHECKS) {
      if (isBroken(html)) failures.push(`${path}: ${label}`);
    }
  }

  report(
    'unframed content in a post body',
    failures,
    'ok: every table, image, chart and embed in a post body is framed',
  );
}

await runMain(import.meta.url, main);
