#!/usr/bin/env node
import { join } from 'node:path';
import { cached } from './lib/cache.mjs';
import { sha256 } from './lib/hash.mjs';
import { attr, rewritePages, swap } from './lib/html.mjs';
import { isMain } from './lib/main.mjs';

const CACHE_DIR = join(process.cwd(), 'embed-cache', 'titles');

async function cachedJson(url) {
  try {
    const bytes = await cached(CACHE_DIR, `${sha256(url).slice(0, 16)}.json`, async () => {
      const res = await fetch(url, { redirect: 'follow' });
      if (!res.ok) throw new Error(`${url}: ${res.status}`);
      return `${JSON.stringify(await res.json(), null, 2)}\n`;
    });
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    return null;
  }
}

async function titleFor(platform, id) {
  if (platform === 'youtube') {
    const d = await cachedJson(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}&format=json`,
    );
    return d?.title ?? null;
  }
  const d = await cachedJson(`https://vimeo.com/api/v2/video/${id}.json`);
  return Array.isArray(d) ? (d[0]?.title ?? null) : null;
}

const escapeHtml = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export default async function fillEmbedTitles(distDir = 'dist', lookup = titleFor) {
  const FIGURE = /<figure class="frame frame--embed">([\s\S]*?)<\/figure>/g;
  let filled = 0;
  let linked = 0;

  const pages = await rewritePages(distDir, async (html) => {
    let out = html;

    for (const [figure, inner] of [...html.matchAll(FIGURE)].map((m) => [m[0], m[1]])) {
      const yt = /<lite-youtube\b[^>]*>/.exec(inner)?.[0];
      const vm = /<lite-vimeo\b[^>]*>/.exec(inner)?.[0];
      const [platform, id] = yt
        ? ['youtube', attr(yt, 'videoid')]
        : vm
          ? ['vimeo', attr(vm, 'data-id')]
          : [null, null];
      if (!platform || !id) continue;

      let next = figure;

      if (/<span class="frame__label"><\/span>/.test(figure)) {
        const title = await lookup(platform, id);
        if (title) {
          next = swap(
            next,
            '<span class="frame__label"></span>',
            `<span class="frame__label">${escapeHtml(title)}</span>`,
          );
          filled++;
        }
      }

      const url =
        platform === 'youtube' ? `https://youtube.com/watch?v=${id}` : `https://vimeo.com/${id}`;
      next = next.replace(
        /<span class="frame__meta">([^<]*)<\/span>/,
        (_m, label) =>
          `<span class="frame__meta"><a class="frame__src" href="${escapeHtml(url)}" rel="noopener">${label}</a></span>`,
      );
      if (next !== figure) {
        if (/frame__src/.test(next)) linked++;
        out = swap(out, figure, next);
      }
    }
    return out;
  });

  console.log(
    `embed titles: ${filled} video title(s) filled, ${linked} source label(s) linked` +
      ` across ${pages} page(s)`,
  );
  return { filled };
}

if (isMain(import.meta.url)) {
  await fillEmbedTitles(process.argv[2]);
}
