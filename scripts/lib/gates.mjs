import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { posixRel, walk } from './fswalk.mjs';
import { isMain } from './main.mjs';

export const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

export class GateError extends Error {}

export function runMain(metaUrl, main) {
  if (!isMain(metaUrl)) return Promise.resolve();
  return main(process.argv[2]).catch((e) => {
    console.error(e instanceof GateError ? `FAIL: ${e.message}` : e);
    process.exitCode = 1;
  });
}

export function report(title, problems, okMessage, limit = Infinity) {
  if (!problems.length) {
    console.log(okMessage);
    return true;
  }
  console.error(`FAIL: ${title}`);
  for (const p of problems.slice(0, limit)) console.error(`  ${p}`);
  process.exitCode = 1;
  return false;
}

export async function* htmlPages(distDir, accept = () => true, what = 'HTML pages') {
  let seen = 0;
  for await (const path of walk(distDir)) {
    if (!path.endsWith('.html')) continue;
    const rel = posixRel(distDir, path);
    if (!accept(rel)) continue;
    seen += 1;
    yield { path, rel, html: await readFile(path, 'utf8') };
  }
  if (!seen) throw new GateError(`${distDir}: no ${what} found, so nothing was checked`);
}

const OPEN_TAG = /<([a-z][a-z0-9-]*)(?:"[^"]*"|'[^']*'|[^<>"'])*>/gi;
const ATTR = /\s([^\s"'<>/=]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;

export function* openTags(html) {
  for (const m of html.matchAll(OPEN_TAG)) yield { name: m[1].toLowerCase(), text: m[0] };
}

export function attrsOf(tagText) {
  const attrs = new Map();
  for (const m of tagText.matchAll(ATTR)) {
    const name = m[1].toLowerCase();
    if (!attrs.has(name)) attrs.set(name, m[2] ?? m[3] ?? m[4]);
  }
  return attrs;
}

const FIGURE_TAG = /<figure\b[^>]*>|<\/figure>/g;
const EMBED_FIGURE_CLASS = /\bclass="[^"]*\bframe--embed\b[^"]*"/;

export function embedFigureSpans(html) {
  const spans = [];
  FIGURE_TAG.lastIndex = 0;
  for (let m; (m = FIGURE_TAG.exec(html));) {
    if (m[0].startsWith('</') || !EMBED_FIGURE_CLASS.test(m[0])) continue;
    let depth = 1;
    let end = html.length;
    for (let inner; (inner = FIGURE_TAG.exec(html));) {
      depth += inner[0].startsWith('</') ? -1 : 1;
      if (depth === 0) {
        end = FIGURE_TAG.lastIndex;
        break;
      }
    }
    spans.push([m.index, end]);
    FIGURE_TAG.lastIndex = end;
  }
  return spans;
}

export function stripEmbedFigures(html) {
  let out = '';
  let pos = 0;
  for (const [start, end] of embedFigureSpans(html)) {
    out += html.slice(pos, start);
    pos = end;
  }
  return out + html.slice(pos);
}
