import { readFile, writeFile } from 'node:fs/promises';
import { findFiles } from './fswalk.mjs';

export const attr = (tag, name) =>
  new RegExp(`(?<![\\w-])${name}\\s*=\\s*"([^"]*)"`, 'i').exec(tag)?.[1] ?? null;

export const swap = (str, from, to) => str.replace(from, () => to);

export function dropSubtree(html, open, tag) {
  let out = '';
  let i = 0;
  for (;;) {
    open.lastIndex = i;
    const start = open.exec(html);
    if (!start) return out + html.slice(i);
    out += html.slice(i, start.index);

    let depth = 1;
    const scan = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'g');
    scan.lastIndex = start.index + start[0].length;
    let end = html.length;
    for (let m; (m = scan.exec(html));) {
      depth += m[1] ? -1 : 1;
      if (depth === 0) {
        end = scan.lastIndex;
        break;
      }
    }
    i = end;
  }
}

export async function rewritePages(distDir, fn) {
  let changed = 0;
  for (const path of await findFiles(distDir, /\.html$/)) {
    const html = await readFile(path, 'utf8');
    const out = await fn(html, path);
    if (typeof out === 'string' && out !== html) {
      await writeFile(path, out);
      changed += 1;
    }
  }
  return changed;
}
