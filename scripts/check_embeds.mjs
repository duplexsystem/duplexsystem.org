#!/usr/bin/env node
import { readFile, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { walk } from './lib/fswalk.mjs';

export function noThirdPartyStylesheet(html) {
  return (
    !/<link\b[^>]*\brel="stylesheet"[^>]*\bhref="https?:\/\/[^"]*"/i.test(html) &&
    !/<link\b[^>]*\bhref="https?:\/\/[^"]*"[^>]*\brel="stylesheet"/i.test(html)
  );
}

export function noGistWidget(html) {
  return !/<astro-embed-gist\b/i.test(html);
}

/** Every .frame--embed figure, depth-counted: Gist output nests a
 *  <figure class="codefig"> per file, so a non-greedy match closes too early. */
function frameEmbedFigures(html) {
  const TAG = /<figure\b[^>]*>|<\/figure>/g;
  const isEmbedOpen = (tag) => /\bclass="[^"]*\bframe--embed\b[^"]*"/.test(tag);

  const figures = [];
  let m;
  while ((m = TAG.exec(html))) {
    if (m[0].startsWith('</') || !isEmbedOpen(m[0])) continue;

    const start = m.index;
    let depth = 1;
    let inner;
    while (depth > 0 && (inner = TAG.exec(html))) {
      depth += inner[0].startsWith('</') ? -1 : 1;
    }
    figures.push(html.slice(start, TAG.lastIndex));
  }
  return figures;
}

export function noEmbedInlineBackground(html) {
  const embeds = frameEmbedFigures(html).map((fig) => fig.replace(/<pre\b[^>]*>/g, '<pre>'));
  // The \s* sits inside the lookahead: outside it the engine backtracks it to
  // zero-width and `background: transparent` passes.
  const OPAQUE_INLINE_BG =
    /\bstyle="[^"]*\bbackground(?:-color)?\s*:(?!\s*(?:transparent|none)\b)\s*[^;"]/i;
  return embeds.every((fig) => !OPAQUE_INLINE_BG.test(fig));
}

const IGNORED_EXT = /\.(br|gz)$/;
const HAYSTACK_EXT = /\.(html|css|js|mjs|xml|json|txt)$/;

const KNOWN_UNREFERENCED = [];

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
    return []; // no _astro directory at all: nothing to check
  }
  if (assets.length === 0) return [];

  let haystack = '';
  for await (const path of walk(distDir)) {
    if (HAYSTACK_EXT.test(path)) haystack += await readFile(path, 'utf8');
  }

  const entries = assets.map((path) => {
    const rel = relative(distDir, path).split(sep).join('/');
    const name = rel.split('/').pop();
    return { rel, name, stem: stemOf(name), referenced: haystack.includes(name) };
  });

  const referencedStems = entries.filter((e) => e.referenced).map((e) => e.stem);
  const hasReferencedDerivative = (stem) =>
    referencedStems.some((s) => s !== stem && s.startsWith(stem));

  return entries
    .filter((e) => !e.referenced && !hasReferencedDerivative(e.stem))
    .map((e) => e.rel)
    .filter((rel) => !KNOWN_UNREFERENCED.some((re) => re.test(rel)));
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

  for await (const path of walk(distDir)) {
    if (!path.endsWith('.html')) continue;
    const html = await readFile(path, 'utf8');
    embedFigures += countEmbedFigures(html);
    for (const [label, isBroken] of CHECKS) {
      if (isBroken(html)) failures.push(`${path}: ${label}`);
    }
  }

  for (const asset of await unreferencedAstroAssets(distDir)) {
    failures.push(`${asset}: unreferenced by any built HTML/CSS/JS, dead weight nothing requests`);
  }

  if (failures.length) {
    console.error('FAIL: embed styling/build-hygiene regression');
    for (const f of failures) console.error(`  ${f}`);
    process.exit(1);
  }

  if (embedFigures === 0) {
    console.error(
      'WARNING: zero .frame--embed figures found in this build. Checks 1-3 (third-party stylesheet, Gist widget regression, inline embed background) validated nothing.',
    );
    console.error('  Run `npm run verify:embeds` to exercise them against real embed content.');
    console.log(
      'ok: no dead build output (embed-specific checks 1-3 had no subject this run, see warning above)',
    );
    return;
  }
  console.log('ok: embeds are self-hosted, restyled and carry no dead build output');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main(process.argv[2]);
}
