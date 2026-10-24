import {
  resolvePost,
  renderPostAsHtml,
} from '../../node_modules/@astro-community/astro-embed-bluesky/src/utils.js';
import {
  fetchMastodonPost,
  replaceEmojis,
} from '../../node_modules/@astro-community/astro-embed-mastodon/src/utils.js';
import { safeGet } from '@astro-community/astro-embed-utils';
import { cached } from './embed-cache';
import matchBluesky from '../../node_modules/@astro-community/astro-embed-bluesky/src/matcher.js';
import matchMastodon from '../../node_modules/@astro-community/astro-embed-mastodon/matcher.js';
import matchTweet from '../../node_modules/@astro-community/astro-embed-twitter/matcher.js';

export interface SocialMedia {
  src: string;
  alt: string;
}

export interface SocialCard {
  title: string;
  description: string | null;
  provider: string | null;
  image: string | null;
  url: string;
}

export interface SocialPost {
  platform: 'bluesky' | 'mastodon' | 'twitter';
  url: string;
  name: string | null;
  handle: string | null;
  avatar: string | null;
  bodyHtml: string;
  date: string | null;
  media: SocialMedia[];
  card: SocialCard | null;
}

export function detectPlatform(url: string): SocialPost['platform'] | null {
  if (matchBluesky(url)) return 'bluesky';
  if (matchTweet(url)) return 'twitter';
  if (matchMastodon(url)) return 'mastodon';
  return null;
}

async function fromBluesky(url: string): Promise<SocialPost | null> {
  const post = await cached('bluesky', url, () => resolvePost(url));
  if (!post) return null;

  const embed: any = post.embed ?? {};
  const media: SocialMedia[] = (embed.images ?? []).map((i: any) => ({
    src: i.thumb ?? i.fullsize,
    alt: i.alt ?? '',
  }));

  const ext = embed.external;
  return {
    platform: 'bluesky',
    url,
    name: post.author?.displayName ?? post.author?.handle ?? null,
    handle: post.author?.handle ? `@${post.author.handle}` : null,
    avatar: post.author?.avatar ?? null,
    bodyHtml: renderPostAsHtml(post) ?? '',
    date: (post.record as any)?.createdAt ?? null,
    media,
    card: ext
      ? {
          title: ext.title,
          description: ext.description || null,
          provider: null,
          image: ext.thumb ?? null,
          url: ext.uri,
        }
      : null,
  };
}

async function fromMastodon(url: string): Promise<SocialPost | null> {
  const post: any = await fetchMastodonPost(url);
  if (!post) return null;

  const card = post.card;
  return {
    platform: 'mastodon',
    url: post.url ?? url,
    name: replaceEmojis(post.account?.display_name ?? '', post.account?.emojis ?? []) || null,
    handle: post.account?.acct ? `@${post.account.acct}` : null,
    avatar: post.account?.avatar ?? null,
    bodyHtml: replaceEmojis(post.content ?? '', post.emojis ?? []),
    date: post.created_at ?? null,
    media: (post.media_attachments ?? [])
      .filter((m: any) => m.type === 'image')
      .map((m: any) => ({ src: m.preview_url ?? m.url, alt: m.description ?? '' })),
    card: card
      ? {
          title: card.title,
          description: card.description || null,
          provider: card.provider_name || null,
          image: card.image ?? null,
          url: card.url,
        }
      : null,
  };
}

async function fromTwitter(url: string): Promise<SocialPost | null> {
  const oembed = new URL('https://publish.twitter.com/oembed');
  oembed.searchParams.set('url', url);
  oembed.searchParams.set('omit_script', 'true');
  oembed.searchParams.set('dnt', 'true');
  const data: any = await safeGet(oembed.href);
  if (!data?.html) return null;

  const bodyHtml = /<p[^>]*>([\s\S]*?)<\/p>/.exec(data.html)?.[1] ?? '';
  const dateText = /<a href="[^"]*">([^<]*)<\/a>\s*<\/blockquote>/.exec(data.html)?.[1] ?? null;
  const permalink =
    /<a href="([^"]*)"[^>]*>[^<]*<\/a>\s*<\/blockquote>/.exec(data.html)?.[1] ?? url;
  const handle = data.author_url ? `@${data.author_url.replace(/\/$/, '').split('/').pop()}` : null;

  return {
    platform: 'twitter',
    url: permalink,
    name: data.author_name ?? null,
    handle,
    avatar: null,
    bodyHtml,
    date: dateText,
    media: [],
    card: null,
  };
}

export async function fetchSocialPost(url: string): Promise<SocialPost | null> {
  switch (detectPlatform(url)) {
    case 'bluesky':
      return fromBluesky(url);
    case 'mastodon':
      return fromMastodon(url);
    case 'twitter':
      return fromTwitter(url);
    default:
      return null;
  }
}
