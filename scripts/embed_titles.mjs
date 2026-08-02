#!/usr/bin/env node
// Fill the empty label in a video embed's frame bar with the video's own title.
// Runs over built HTML, not in the rehype plugin: the lookup is a network call,
// and this keeps third-party fetches behind the same committed cache.
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { walk } from './lib/fswalk.mjs';

const CACHE_DIR = join(process.cwd(), 'embed-cache', 'titles');

async function cachedJson(url) {
  const file = join(
    CACHE_DIR,
    `${createHash('sha256').update(url).digest('hex').slice(0, 16)}.json`,
  );
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {}
  try {
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) return null;
    const data = await res.json();
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(file, `${JSON.stringify(data, null, 2)}\n`);
    return data;
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

export async function fillEmbedTitles(distDir = 'dist') {
  const files = [];
  for await (const path of walk(distDir)) {
    if (path.endsWith('.html')) files.push(path);
  }

  const FIGURE = /<figure class="frame frame--embed">([\s\S]*?)<\/figure>/g;
  let filled = 0;
  let linked = 0;
  const pages = new Set();

  for (const page of files) {
    const html = await readFile(page, 'utf8');
    let out = html;

    for (const [figure, inner] of [...html.matchAll(FIGURE)].map((m) => [m[0], m[1]])) {
      const yt = /<lite-youtube[^>]*\bvideoid="([^"]+)"/.exec(inner);
      const vm = /<lite-vimeo[^>]*\bdata-id="([^"]+)"/.exec(inner);
      const [platform, id] = yt ? ['youtube', yt[1]] : vm ? ['vimeo', vm[1]] : [null, null];
      if (!platform) continue;

      let next = figure;

      if (/<span class="frame__label"><\/span>/.test(figure)) {
        const title = await titleFor(platform, id);
        if (title) {
          next = next.replace(
            '<span class="frame__label"></span>',
            `<span class="frame__label">${escapeHtml(title)}</span>`,
          );
          filled++;
        }
      }

      // Link the source name: play swaps the embed's only anchor for an iframe,
      // which a redirect extension may aim at an instance that refuses framing.
      // A link in the chrome still reaches the video, without JS.
      const url =
        platform === 'youtube' ? `https://youtube.com/watch?v=${id}` : `https://vimeo.com/${id}`;
      next = next.replace(
        /<span class="frame__meta">([^<]*)<\/span>/,
        (_m, label) =>
          `<span class="frame__meta"><a class="frame__src" href="${escapeHtml(url)}" rel="noopener">${label}</a></span>`,
      );
      if (next !== figure) {
        if (/frame__src/.test(next)) linked++;
        out = out.replace(figure, next);
      }
    }

    if (out !== html) {
      await writeFile(page, out);
      pages.add(page);
    }
  }

  console.log(
    `embed titles: ${filled} video title(s) filled, ${linked} source label(s) linked` +
      ` across ${pages.size} page(s)`,
  );
  return { filled };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await fillEmbedTitles(process.argv[2] ?? 'dist');
}
