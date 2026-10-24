import rss from '@astrojs/rss';
import { postPath, postUpdated, type Post } from './posts';
import { SITE } from './site';

export interface FeedItem {
  url: string;
  title: string;
  summary: string;
  published: Date;
  updated: Date;
  tags: string[];
}

export function feedItems(posts: Post[], site: URL): FeedItem[] {
  return posts.map((post) => ({
    url: new URL(postPath(post.id), site).href,
    title: post.data.title,
    summary: post.data.description,
    published: post.data.pubDate,
    updated: postUpdated(post) ?? post.data.pubDate,
    tags: post.data.tags,
  }));
}

export function lastChange(items: FeedItem[]): Date | undefined {
  return items.reduce<Date | undefined>(
    (max, i) => (!max || i.updated > max ? i.updated : max),
    undefined,
  );
}

export function xmlEscape(s: string): string {
  return s.replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!,
  );
}

export function rssFeed({
  items,
  self,
  site,
  title = SITE.name,
  description = SITE.description,
}: {
  items: FeedItem[];
  self: string;
  site: URL;
  title?: string;
  description?: string;
}) {
  const updated = lastChange(items);
  return rss({
    title,
    description,
    site,
    xmlns: {
      atom: 'http://www.w3.org/2005/Atom',
      dc: 'http://purl.org/dc/elements/1.1/',
    },
    items: items.map((item) => ({
      title: item.title,
      description: item.summary,
      pubDate: item.published,
      link: item.url,
      categories: item.tags,
      customData: `<dc:creator>${xmlEscape(SITE.author)}</dc:creator>`,
    })),
    customData: [
      '<language>en-us</language>',
      `<atom:link href="${xmlEscape(self)}" rel="self" type="application/rss+xml"/>`,
      updated ? `<lastBuildDate>${updated.toUTCString()}</lastBuildDate>` : '',
    ].join(''),
  });
}
