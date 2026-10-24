import { getCollection, type CollectionEntry } from 'astro:content';
import { includeDrafts } from './drafts';
import { updatedAfter } from './last-edited';

export type Post = CollectionEntry<'blog'>;

export async function getPublishedPosts(): Promise<Post[]> {
  const posts = await getCollection(
    'blog',
    ({ data }) => import.meta.env.DEV || includeDrafts() || !data.draft,
  );
  return posts.sort(
    (a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf() || a.id.localeCompare(b.id),
  );
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

export const postUpdated = (post: Post): Date | undefined =>
  updatedAfter(post.data.pubDate, post.data.updatedDate, post.filePath);

export const postPath = (id: string): string => `/blog/${id}/`;

export async function tagStaticPaths() {
  const posts = await getPublishedPosts();
  return collectTags(posts).map(({ tag }) => ({
    params: { tag },
    props: { tag, posts: posts.filter((p) => p.data.tags.includes(tag)) },
  }));
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function formatDate(d: Date): string {
  return isoDate(d).replaceAll('-', '·');
}

export function countLabel(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}
