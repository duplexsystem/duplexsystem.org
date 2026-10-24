import { readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

export async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else yield path;
  }
}

export async function findFiles(dir, pattern) {
  const out = [];
  for await (const path of walk(dir)) if (pattern.test(path)) out.push(path);
  return out;
}

export const posixRel = (root, path) => relative(root, path).split(sep).join('/');
