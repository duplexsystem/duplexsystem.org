import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// process.cwd(), not import.meta.url: Astro's static build relocates this
// module under dist/ before executing it, so a URL-relative path lands there.
const CACHE_DIR = join(process.cwd(), 'embed-cache', 'gist');

export function gistIdFromUrl(url) {
  const { pathname } = new URL(url);
  const segments = pathname.split('/').filter(Boolean);
  const id = segments.at(-1);
  if (!id) throw new Error(`Cannot extract a gist id from ${url}`);
  return id;
}

function cachePath(id) {
  return join(CACHE_DIR, `${id}.json`);
}

async function readCache(id) {
  try {
    return JSON.parse(await readFile(cachePath(id), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return undefined;
    throw err;
  }
}

async function writeCache(id, data) {
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(cachePath(id), JSON.stringify(data, null, 2));
}

async function fetchJson(url, gistUrl) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch gist ${gistUrl}: HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * Gist owner, canonical URL and file contents, on-disk cache first.
 *
 * The cache is required, not an optimisation: GitHub allows 60 unauthenticated
 * requests/hour. A cache miss plus a failed fetch throws rather than returning
 * a placeholder, so a broken embed breaks the build instead of shipping.
 */
export async function fetchGist(url) {
  const id = gistIdFromUrl(url);

  const cached = await readCache(id);
  if (cached) return cached;

  const gist = await fetchJson(`https://api.github.com/gists/${id}`, url);

  const files = {};
  for (const [filename, file] of Object.entries(gist.files ?? {})) {
    let { content } = file;
    if (file.truncated && file.raw_url) {
      const res = await fetch(file.raw_url);
      if (!res.ok) {
        throw new Error(
          `Failed to fetch full content of "${filename}" in gist ${url}: HTTP ${res.status}`,
        );
      }
      content = await res.text();
    }
    files[filename] = { filename: file.filename, language: file.language, content };
  }

  const result = { owner: gist.owner?.login, html_url: gist.html_url, files };
  await writeCache(id, result);
  return result;
}
