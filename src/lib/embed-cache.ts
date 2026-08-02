import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * On-disk cache for third-party embed API responses, committed to the repo:
 * builds stay offline and reproducible, embedded content is pinned against
 * later deletion, and changes show up in a diff. Refresh by deleting the file
 * or directory and rebuilding.
 *
 * process.cwd(), not import.meta.url: Astro relocates SSR modules before
 * executing them, so a URL-relative path resolves inside dist/.
 */
const CACHE_ROOT = join(process.cwd(), 'embed-cache');

function keyFor(url: string): string {
  const slug = url
    .replace(/^https?:\/\//, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70)
    .toLowerCase();
  const hash = createHash('sha256').update(url).digest('hex').slice(0, 8);
  return `${slug}-${hash}`;
}

/**
 * Cached response for `url`, else `fetcher`'s result, cached.
 * A null/undefined result is not cached: a transient network failure must not
 * be written down as "this post does not exist" and served from disk forever.
 */
export async function cached<T>(
  namespace: string,
  url: string,
  fetcher: () => Promise<T>,
): Promise<T | null> {
  const dir = join(CACHE_ROOT, namespace);
  const file = join(dir, `${keyFor(url)}.json`);

  try {
    return JSON.parse(await readFile(file, 'utf8')) as T;
  } catch {}

  const fresh = await fetcher();
  if (fresh === null || fresh === undefined) return null;

  await mkdir(dir, { recursive: true });
  await writeFile(file, `${JSON.stringify(fresh, null, 2)}\n`);
  return fresh;
}
