import type { APIContext } from 'astro';
import { tagStaticPaths, type Post } from '../../../lib/posts';
import { feedItems, rssFeed } from '../../../lib/feed';
import { SITE } from '../../../lib/site';

export const getStaticPaths = tagStaticPaths;

export async function GET(context: APIContext) {
  const { tag, posts } = context.props as { tag: string; posts: Post[] };
  const site = context.site!;
  return rssFeed({
    items: feedItems(posts, site),
    self: new URL(`/tags/${tag}/rss.xml`, site).href,
    site,
    title: `${SITE.name} · #${tag}`,
    description: `Writing tagged ${tag}.`,
  });
}
