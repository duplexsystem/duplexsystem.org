#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { posixRel, walk } from './lib/fswalk.mjs';
import { attrsOf, embedFigureSpans, htmlPages, openTags, report, runMain } from './lib/gates.mjs';
import { findFiles } from './lib/fswalk.mjs';

export function noThirdPartyStylesheet(html) {
  for (const { name, text } of openTags(html)) {
    if (name !== 'link') continue;
    const attrs = attrsOf(text);
    const rel = (attrs.get('rel') ?? '').toLowerCase().split(/\s+/);
    if (rel.includes('stylesheet') && /^(?:https?:)?\/\//i.test(attrs.get('href') ?? '')) {
      return false;
    }
  }
  return true;
}

export function noGistWidget(html) {
  return !/<astro-embed-gist\b/i.test(html);
}

export function noEmbedInlineBackground(html) {
  const embeds = embedFigureSpans(html).map(([start, end]) =>
    html.slice(start, end).replace(/<pre\b[^>]*>/g, '<pre>'),
  );
  const OPAQUE_INLINE_BG =
    /\bstyle="[^"]*\bbackground(?:-color)?\s*:(?!\s*(?:transparent|none)\b)\s*[^;"]/i;
  return embeds.every((fig) => !OPAQUE_INLINE_BG.test(fig));
}

const PLAYER_DEFINE = /customElements\.define\(\s*[`"'](lite-(?:youtube|vimeo))[`"']/g;
const PRIVACY_SETTINGS = {
  'lite-youtube': [
    /\.preconnected\s*=\s*(?:true|!0)(?![\w$])/,
    /\.needsYTApi\s*=\s*(?:false|!1)(?![\w$])/,
  ],
  'lite-vimeo': [/\.preconnected\s*=\s*(?:true|!0)(?![\w$])/],
};

export function playersUsed(html) {
  const used = new Set();
  for (const { name } of openTags(html)) if (name in PRIVACY_SETTINGS) used.add(name);
  return used;
}

export function playerPrivacyGaps(js) {
  const gaps = new Map();
  for (const m of js.matchAll(PLAYER_DEFINE)) {
    const after = js.slice(m.index);
    gaps.set(m[1], PRIVACY_SETTINGS[m[1]].filter((re) => !re.test(after)).map(String));
  }
  return gaps;
}

export async function playerPrivacyProblems(distDir, usedByPage) {
  const defined = new Set();
  const problems = [];
  for (const path of await findFiles(distDir, /\.m?js$/)) {
    for (const [name, missing] of playerPrivacyGaps(await readFile(path, 'utf8'))) {
      defined.add(name);
      if (missing.length) {
        problems.push(
          `${path}: <${name}> player lacks the build's privacy settings ${missing.join(' ')}`,
        );
      }
    }
  }
  for (const [page, names] of usedByPage) {
    for (const name of names) {
      if (!defined.has(name))
        problems.push(`${page}: <${name}> used but no shipped script defines it`);
    }
  }
  return problems;
}

const IGNORED_EXT = /\.(br|gz|jxl)$/;
const HAYSTACK_EXT = /\.(html|css|js|mjs|xml|json|txt)$/;

function stemOf(name) {
  const i = name.lastIndexOf('.');
  return i === -1 ? name : name.slice(0, i);
}

export async function unreferencedAstroAssets(distDir) {
  const assetsDir = join(distDir, '_astro');
  const assets = [];
  try {
    for await (const path of walk(assetsDir)) {
      if (!IGNORED_EXT.test(path)) assets.push(path);
    }
  } catch {
    return [];
  }
  if (assets.length === 0) return [];

  let haystack = '';
  for await (const path of walk(distDir)) {
    if (HAYSTACK_EXT.test(path)) haystack += await readFile(path, 'utf8');
  }

  const entries = assets.map((path) => {
    const rel = posixRel(distDir, path);
    const name = rel.split('/').pop();
    return { rel, name, stem: stemOf(name), referenced: haystack.includes(name) };
  });

  const referencedStems = entries.filter((e) => e.referenced).map((e) => e.stem);
  const hasReferencedDerivative = (stem) =>
    referencedStems.some((s) => s !== stem && s.startsWith(stem));

  return entries.filter((e) => !e.referenced && !hasReferencedDerivative(e.stem)).map((e) => e.rel);
}

const CHECKS = [
  ['links a third-party stylesheet', (html) => !noThirdPartyStylesheet(html)],
  [
    "a gist renders as GitHub's own <astro-embed-gist> (the Gist binding regressed)",
    (html) => !noGistWidget(html),
  ],
  [
    'an embed keeps its own inline background (the frame no longer owns the container)',
    (html) => !noEmbedInlineBackground(html),
  ],
];

const EMBED_FIGURE_OPEN = /<figure\b[^>]*\bclass="[^"]*\bframe--embed\b[^"]*"[^>]*>/g;

export function countEmbedFigures(html) {
  return (html.match(EMBED_FIGURE_OPEN) ?? []).length;
}

async function main(distDir = 'dist') {
  const failures = [];
  let embedFigures = 0;
  const usedByPage = new Map();

  for await (const { path, html } of htmlPages(distDir)) {
    embedFigures += countEmbedFigures(html);
    const players = playersUsed(html);
    if (players.size) usedByPage.set(path, players);
    for (const [label, isBroken] of CHECKS) {
      if (isBroken(html)) failures.push(`${path}: ${label}`);
    }
  }

  failures.push(...(await playerPrivacyProblems(distDir, usedByPage)));

  for (const asset of await unreferencedAstroAssets(distDir)) {
    failures.push(`${asset}: unreferenced by any built HTML/CSS/JS, dead weight nothing requests`);
  }

  if (!failures.length && embedFigures === 0) {
    console.error(
      'WARNING: zero .frame--embed figures found in this build. Checks 1-3 (third-party stylesheet, Gist widget regression, inline embed background) validated nothing.',
    );
    console.error('  Run `npm run verify:embeds` to exercise them against real embed content.');
    console.log(
      'ok: no dead build output (embed-specific checks 1-3 had no subject this run, see warning above)',
    );
    return;
  }
  report(
    'embed styling/build-hygiene regression',
    failures,
    'ok: embeds are self-hosted, restyled and carry no dead build output',
  );
}

await runMain(import.meta.url, main);
