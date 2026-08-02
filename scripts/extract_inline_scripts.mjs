#!/usr/bin/env node
// Move astro-embed's inline custom-element definitions into real files under
// /js/: CSP is script-src 'self', so inline definitions never execute and the
// elements never upgrade.
// Files rather than CSP hashes: a hash pins the policy to a dependency's bytes,
// LibreJS blocks inline scripts anyway, and /licenses/ gets a URL to link.
// Must run before optimize_assets: the extracted files still need minifying.
import { readFile, writeFile, mkdir, readdir, access } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { walk } from './lib/fswalk.mjs';

const INLINE_MODULE = /<script(?![^>]*\bsrc=)[^>]*\btype="module"[^>]*>([\s\S]*?)<\/script>/g;

function elementName(body) {
  // Backticks matter: pre-esbuild, Vite emits define(`lite-youtube`, e).
  const m = body.match(/customElements\.define\(\s*[`"']([a-z][a-z0-9]*(?:-[a-z0-9]+)+)[`"']/);
  return m ? m[1] : null;
}

const EXPAT_MAGNET = 'magnet:?xt=urn:btih:d3d9a9a6595521f9666a5e94cc830dab83b65699&dn=expat.txt';

async function pruneWebLabels(distDir) {
  const page = join(distDir, 'licenses', 'index.html');
  let html;
  try {
    html = await readFile(page, 'utf8');
  } catch {
    return 0; // no licences page in this build
  }

  const rows = [...html.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/g)];
  const doomed = [];
  for (const row of rows) {
    const href = row[0].match(/href="(\/js\/[^"]+\.js)"/);
    if (!href) continue;
    try {
      await access(join(distDir, href[1]));
    } catch {
      doomed.push(row);
    }
  }
  if (!doomed.length) return 0;

  let out = '';
  let pos = 0;
  for (const row of doomed) {
    out += html.slice(pos, row.index);
    pos = row.index + row[0].length;
  }
  out += html.slice(pos);
  await writeFile(page, out);
  return doomed.length;
}

export async function extractInlineScripts(distDir = 'dist') {
  const extracted = new Map();
  const unnamed = [];
  let rewrites = 0;

  for await (const page of walk(distDir)) {
    if (!page.endsWith('.html')) continue;
    const html = await readFile(page, 'utf8');
    let out = html;

    for (const match of [...html.matchAll(INLINE_MODULE)]) {
      const [tag, body] = match;
      const name = elementName(body);
      if (!name) {
        unnamed.push(`${relative(distDir, page).split(sep).join('/')} (${body.length} bytes)`);
        continue;
      }

      const seen = extracted.get(name);
      if (seen !== undefined && seen !== body) {
        throw new Error(
          `two different definitions of <${name}> found; cannot extract both to /js/${name}.js`,
        );
      }
      extracted.set(name, body);

      out = out.split(tag).join(`<script type="module" src="/js/${name}.js"></script>`);
      rewrites++;
    }

    if (out !== html) await writeFile(page, out);
  }

  if (extracted.size > 0) {
    await mkdir(join(distDir, 'js'), { recursive: true });
    for (const [name, body] of extracted) {
      await writeFile(
        join(distDir, 'js', `${name}.js`),
        `// @license ${EXPAT_MAGNET} MIT\n// <${name}> from astro-embed, extracted from inline by\n` +
          `// scripts/extract_inline_scripts.mjs. Unmodified otherwise.\n${body}\n// @license-end\n`,
      );
    }
  }

  if (unnamed.length) {
    console.warn(
      `warning: ${unnamed.length} inline <script type="module"> block(s) register no custom element ` +
        'and were left inline, CSP will block them:',
    );
    for (const u of unnamed) console.warn(`  ${u}`);
  }

  const pruned = await pruneWebLabels(distDir);

  console.log(
    `inline scripts: ${extracted.size} custom element(s) extracted to /js/, ${rewrites} tag(s) rewritten` +
      (pruned ? `, ${pruned} unshipped Web Labels row(s) pruned` : ''),
  );
  return { extracted: [...extracted.keys()], rewrites, unnamed };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await extractInlineScripts(process.argv[2]);
}
