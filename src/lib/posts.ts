import { getCollection, type CollectionEntry } from 'astro:content';

export type Post = CollectionEntry<'blog'>;

/**
 * Newest first. Drafts are kept in dev, dropped in production builds.
 *
 * `INCLUDE_DRAFTS=1` must be honoured here as well as in content.config.ts's
 * loader: without this filter a draft loads but gets no page route.
 */
export async function getPublishedPosts(): Promise<Post[]> {
  const posts = await getCollection(
    'blog',
    ({ data }) => import.meta.env.DEV || !!process.env.INCLUDE_DRAFTS || !data.draft,
  );
  return posts.sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf());
}

export function collectTags(posts: Post[]): Array<{ tag: string; count: number }> {
  const counts = new Map<string, number>();
  for (const post of posts) {
    for (const tag of post.data.tags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

export function formatDate(d: Date): string {
  const iso = d.toISOString().slice(0, 10);
  return iso.replaceAll('-', '·');
}

/**
 * `3 posts` / `1 post`. Counts must never ship as a bare digit: a screen reader
 * announces "link, hashtag-meta, 1" with no referent for the 1.
 */
export function countLabel(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}
