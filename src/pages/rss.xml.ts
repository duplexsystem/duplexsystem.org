import type { APIContext } from 'astro';
import { getPublishedPosts } from '../lib/posts';
import { feedItems, rssFeed } from '../lib/feed';

export async function GET(context: APIContext) {
  const items = feedItems(await getPublishedPosts(), context.site!);
  return rssFeed({ items, self: new URL('/rss.xml', context.site!).href, site: context.site! });
}
