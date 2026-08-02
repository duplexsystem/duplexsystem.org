#!/usr/bin/env node
// Download every image an embed points at, convert to WebP, cache in-repo, and
// rewrite to a local URL: no reader's browser contacts a third-party host.
// Over built HTML, not per component: images arrive by src, srcset and
// background-image, and after the build they are all just URLs in markup.
// The cache is committed, so builds make no network calls. Delete to refresh.
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { walk } from './lib/fswalk.mjs';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

const CACHE_DIR = join(process.cwd(), 'embed-cache', 'media');
const PUBLIC_PREFIX = '/embeds';

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

    // Extension alone is not enough: Bluesky, Mastodon and Vimeo serve
    // extensionless image URLs, so match on host and path shape too.
    const looksLikeImage =
      /\.(avif|gif|jpe?g|png|webp)(\?|$)/i.test(url) ||
      IMAGE_HOSTS.some((h) => parsed.hostname === h || parsed.hostname.endsWith(`.${h}`)) ||
      /\/(img|image|images|media|avatars|preview_cards|feed_thumbnail)\//i.test(parsed.pathname);
    if (looksLikeImage) urls.add(url);
  }
  return urls;
}

const hashOf = (url) => createHash('sha256').update(url).digest('hex').slice(0, 16);

async function cacheImage(url) {
  const file = join(CACHE_DIR, `${hashOf(url)}.webp`);
  try {
    await readFile(file);
    return file;
  } catch {}

  let res;
  try {
    res = await fetch(url, { redirect: 'follow' });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  if (!(res.headers.get('content-type') ?? '').startsWith('image/')) return null;

  const input = Buffer.from(await res.arrayBuffer());
  let output;
  try {
    output = await sharp(input, { animated: true }).webp({ effort: 6, quality: 82 }).toBuffer();
  } catch {
    return null;
  }

  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(file, output);
  return file;
}

export async function localizeEmbedMedia(distDir = 'dist') {
  const htmlFiles = [];
  for await (const path of walk(distDir)) {
    if (path.endsWith('.html')) htmlFiles.push(path);
  }

  const urls = new Set();
  const contents = new Map();
  for (const path of htmlFiles) {
    const html = await readFile(path, 'utf8');
    contents.set(path, html);
    for (const url of findImageUrls(html)) urls.add(url);
  }

  const mapping = new Map();
  let bytes = 0;
  for (const url of urls) {
    const cached = await cacheImage(url);
    if (!cached) continue;
    const name = `${hashOf(url)}.webp`;
    const dest = join(distDir, 'embeds', name);
    await mkdir(join(distDir, 'embeds'), { recursive: true });
    await copyFile(cached, dest);
    mapping.set(url, `${PUBLIC_PREFIX}/${name}`);
    bytes += (await readFile(cached)).length;
  }

  let rewritten = 0;
  for (const [path, html] of contents) {
    let out = html;
    for (const [url, local] of mapping) {
      const encoded = url.replace(/&/g, '&amp;');
      if (out.includes(url) || out.includes(encoded)) {
        out = out.split(url).join(local).split(encoded).join(local);
      }
    }
    if (out !== html) {
      await writeFile(path, out);
      rewritten++;
    }
  }

  const remaining = new Set();
  for (const path of htmlFiles) {
    for (const url of findImageUrls(await readFile(path, 'utf8'))) remaining.add(url);
  }

  console.log(
    `localized embed media: ${mapping.size} image(s), ${(bytes / 1000).toFixed(1)} kB cached, ` +
      `${rewritten} page(s) rewritten` +
      (remaining.size ? `, ${remaining.size} left remote (not an image or unreachable)` : ''),
  );
  for (const url of remaining) console.log(`  left remote: ${url}`);
  return { localized: mapping.size, remaining: [...remaining] };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await localizeEmbedMedia(process.argv[2] ?? 'dist');
}
