#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { cached } from './lib/cache.mjs';
import { sha256 } from './lib/hash.mjs';
import { rewritePages } from './lib/html.mjs';
import { isMain } from './lib/main.mjs';

const CACHE_DIR = join(process.cwd(), 'embed-cache', 'media');
const OUT_DIR = 'embeds';

const IMAGE_HOSTS = ['i.ytimg.com', 'i.vimeocdn.com', 'cdn.bsky.app', 'files.mastodon.social'];

const SKIP_HOSTS = new Set(['duplexsystem.org']);

function findImageUrls(html) {
  const markup = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');

  const urls = new Set();
  const re = /https?:\/\/[^\s"'<>()\\]+/g;
  for (const raw of markup.match(re) ?? []) {
    const url = raw.replace(/&amp;/g, '&');
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      continue;
    }
    if (SKIP_HOSTS.has(parsed.hostname)) continue;

    const looksLikeImage =
      /\.(avif|gif|jpe?g|png|webp)(\?|$)/i.test(url) ||
      IMAGE_HOSTS.some((h) => parsed.hostname === h || parsed.hostname.endsWith(`.${h}`)) ||
      /\/(img|image|images|media|avatars|preview_cards|feed_thumbnail)\//i.test(parsed.pathname);
    if (looksLikeImage) urls.add(url);
  }
  return urls;
}

const hashOf = (url) => sha256(url).slice(0, 16);

async function cacheImage(url) {
  try {
    return await cached(CACHE_DIR, `${hashOf(url)}.webp`, async () => {
      const res = await fetch(url, { redirect: 'follow' });
      if (!res.ok || !(res.headers.get('content-type') ?? '').startsWith('image/')) {
        throw new Error(`${url}: not an image`);
      }
      const input = Buffer.from(await res.arrayBuffer());
      return sharp(input, { animated: true }).webp({ effort: 6, quality: 82 }).toBuffer();
    });
  } catch {
    return null;
  }
}

export function rewriteUrls(html, mapping) {
  let out = html;
  for (const [url, local] of [...mapping].sort((a, b) => b[0].length - a[0].length)) {
    out = out.split(url.replace(/&/g, '&amp;')).join(local).split(url).join(local);
  }
  return out;
}

export default async function localizeEmbedMedia(distDir = 'dist') {
  const urls = new Set();
  await rewritePages(distDir, (html) => {
    for (const url of findImageUrls(html)) urls.add(url);
  });

  const mapping = new Map();
  let bytes = 0;
  for (const url of urls) {
    const webp = await cacheImage(url);
    if (!webp) continue;
    const name = `${sha256(webp).slice(0, 16)}.webp`;
    await mkdir(join(distDir, OUT_DIR), { recursive: true });
    await writeFile(join(distDir, OUT_DIR, name), webp);
    mapping.set(url, `/${OUT_DIR}/${name}`);
    bytes += webp.length;
  }

  const remaining = new Set();
  const rewritten = await rewritePages(distDir, (html) => {
    const out = rewriteUrls(html, mapping);
    for (const url of findImageUrls(out)) remaining.add(url);
    return out;
  });

  console.log(
    `localized embed media: ${mapping.size} image(s), ${(bytes / 1000).toFixed(1)} kB cached, ` +
      `${rewritten} page(s) rewritten` +
      (remaining.size ? `, ${remaining.size} left remote (not an image or unreachable)` : ''),
  );
  for (const url of remaining) console.log(`  left remote: ${url}`);
  return { localized: mapping.size, remaining: [...remaining] };
}

if (isMain(import.meta.url)) {
  await localizeEmbedMedia(process.argv[2]);
}
