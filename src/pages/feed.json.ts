import type { APIContext } from 'astro';
import { getPublishedPosts } from '../lib/posts';
import { feedItems } from '../lib/feed';
import { SITE } from '../lib/site';

export async function GET(context: APIContext) {
  const site = context.site!;
  const items = feedItems(await getPublishedPosts(), site);
  const author = { name: SITE.author, url: SITE.url };
  const feed = {
    version: 'https://jsonfeed.org/version/1.1',
    title: SITE.name,
    home_page_url: SITE.url,
    feed_url: new URL('/feed.json', site).href,
    description: SITE.description,
    language: 'en',
    authors: [author],
    items: items.map((item) => ({
      id: item.url,
      url: item.url,
      title: item.title,
      content_text: item.summary,
      date_published: item.published.toISOString(),
      date_modified: item.updated.toISOString(),
      tags: item.tags,
      authors: [author],
    })),
  };
  return new Response(JSON.stringify(feed, null, 2), {
    headers: { 'Content-Type': 'application/feed+json; charset=utf-8' },
  });
}
