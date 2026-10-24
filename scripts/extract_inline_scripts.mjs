#!/usr/bin/env node
import { readFile, writeFile, mkdir, access, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { posixRel } from './lib/fswalk.mjs';
import { attr, rewritePages } from './lib/html.mjs';
import { isMain } from './lib/main.mjs';

const SCRIPT = /<script\b([^>]*)>([\s\S]*?)<\/script>/g;
const HAS_IMPORT = /(?:^|[;}\s])import\s*[\s{*"'(]|\bfrom\s*["']/;

function elementNames(body) {
  return [
    ...body.matchAll(/customElements\.define\(\s*[`"']([a-z][a-z0-9]*(?:-[a-z0-9]+)+)[`"']/g),
  ].map((m) => m[1]);
}

export const PRIVACY = {
  'lite-youtube': `{
  const C = customElements.get('lite-youtube');
  C.preconnected = true;
  for (const el of document.querySelectorAll('lite-youtube')) el.needsYTApi = false;
}`,
  'lite-vimeo': `customElements.get('lite-vimeo').preconnected = true;`,
};

const EXPAT_MAGNET = 'magnet:?xt=urn:btih:d3d9a9a6595521f9666a5e94cc830dab83b65699&dn=expat.txt';

async function pruneWebLabels(distDir) {
  const page = join(distDir, 'licenses', 'index.html');
  let html;
  try {
    html = await readFile(page, 'utf8');
  } catch {
    return 0;
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

export default async function extractInlineScripts(distDir = 'dist') {
  const extracted = new Map();
  const unnamed = [];
  const moved = new Set();
  let rewrites = 0;

  const claim = (name, body) => {
    const seen = extracted.get(name);
    if (seen !== undefined && seen !== body) {
      throw new Error(
        `two different definitions of <${name}> found; cannot extract both to /js/${name}.js`,
      );
    }
    extracted.set(name, body);
  };

  await rewritePages(distDir, async (html, page) => {
    let out = '';
    let pos = 0;
    for (const match of html.matchAll(SCRIPT)) {
      const [tag, attrs, inlineBody] = match;
      if (attr(attrs, 'type') !== 'module') continue;
      const src = attr(attrs, 'src');

      let body = inlineBody.trim();
      if (src) {
        if (!/^\/_astro\/[^?#]+\.js$/.test(src)) continue;
        try {
          body = (await readFile(join(distDir, src), 'utf8')).trim();
        } catch {
          continue;
        }
      }
      const [name] = elementNames(body);
      if (!name || (src && HAS_IMPORT.test(body))) {
        if (!src) unnamed.push(`${posixRel(distDir, page)} (${body.length} bytes)`);
        continue;
      }

      claim(name, body);
      if (src) moved.add(join(distDir, src));
      out += `${html.slice(pos, match.index)}<script type="module" src="/js/${name}.js"></script>`;
      pos = match.index + tag.length;
      rewrites++;
    }
    return out + html.slice(pos);
  });

  for (const file of moved) await unlink(file);

  if (extracted.size > 0) {
    await mkdir(join(distDir, 'js'), { recursive: true });
    for (const [name, body] of extracted) {
      const privacy = [...new Set(elementNames(body))]
        .filter((n) => PRIVACY[n])
        .map(
          (n) =>
            `\n// Added by the build: no contact with the video host before play (PRIVACY).\n${PRIVACY[n]}`,
        )
        .join('');
      await writeFile(
        join(distDir, 'js', `${name}.js`),
        `// @license ${EXPAT_MAGNET} MIT\n// <${name}> from astro-embed, extracted from inline by\n` +
          `// scripts/extract_inline_scripts.mjs.\n${body}${privacy}\n// @license-end\n`,
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

if (isMain(import.meta.url)) {
  await extractInlineScripts(process.argv[2]);
}
