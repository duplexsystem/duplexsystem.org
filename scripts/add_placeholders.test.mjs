import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import addPlaceholders from './add_placeholders.mjs';

const solid = (width, height, channels = 3, background = '#c0507a') =>
  sharp({ create: { width, height, channels, background } }).png().toBuffer();

async function site(body) {
  const dist = await mkdtemp(join(tmpdir(), 'placeholders-'));
  await mkdir(join(dist, 'i'));
  await writeFile(join(dist, 'i', 'wide.png'), await solid(400, 200));
  await writeFile(join(dist, 'i', 'small.png'), await solid(200, 100));
  await writeFile(
    join(dist, 'i', 'clear.png'),
    await solid(400, 200, 4, { r: 0, g: 0, b: 0, alpha: 0.5 }),
  );
  await writeFile(join(dist, 'index.html'), `<body>${body}</body>`);
  return dist;
}

async function run(body) {
  const dist = await site(body);
  const log = console.log;
  console.log = () => {};
  try {
    const stats = await addPlaceholders(dist);
    const once = await readFile(join(dist, 'index.html'), 'utf8');
    const again = await addPlaceholders(dist);
    const twice = await readFile(join(dist, 'index.html'), 'utf8');
    return { stats, once, twice, again };
  } finally {
    console.log = log;
    await rm(dist, { recursive: true, force: true });
  }
}

describe('add_placeholders', () => {
  it('wraps a wide image once, with its size, and a second run changes nothing', async () => {
    const { stats, once, twice, again } = await run('<img src="/i/wide.png" alt="x">');
    expect(stats.wrapped).toBe(1);
    expect(once).toMatch(
      /^<body><span class="ph"><i class="ph__b" style="[^"]+" aria-hidden="true"><\/i><img decoding="sync" width="400" height="200" src="\/i\/wide\.png" alt="x"><\/span>/,
    );
    expect(twice).toBe(once);
    expect(again.wrapped).toBe(0);
  });

  it('leaves transparent images alone and makes small ones eager', async () => {
    const { stats, once } = await run(
      '<img src="/i/clear.png" alt=""><img src="/i/small.png" alt="" loading="lazy">',
    );
    expect(stats).toMatchObject({ transparent: 1, skipped: 1, eagered: 1, wrapped: 0 });
    expect(once).toContain('<img src="/i/clear.png" alt="">');
    expect(once).toContain(
      '<img loading="eager" decoding="sync" width="200" height="100" src="/i/small.png" alt="">',
    );
  });

  it("decides by each tag's own width, not by whichever tag named the file first", async () => {
    const { once } = await run(
      '<img src="/i/small.png" alt=""><img src="/i/small.png" width="400" alt="">' +
        '<img src="/i/wide.png" width="100" alt="">',
    );
    expect(once.match(/class="ph__b"/g)).toHaveLength(1);
    expect(once).toMatch(
      /<\/i><img decoding="sync" src="\/i\/small\.png" width="400" alt=""><\/span>/,
    );
    expect(once).toContain(
      '<img loading="eager" decoding="sync" src="/i/wide.png" width="100" alt="">',
    );
  });

  it('reads a tag whose attribute holds ">"', async () => {
    const { once } = await run('<img src="/i/wide.png" alt="a -> b">');
    expect(once).toContain('alt="a -> b"></span>');
  });

  it('wraps the whole <picture>, so its <source> still applies to the <img>', async () => {
    const { once, twice } = await run(
      '<picture><source srcset="/i/wide.png" type="image/png"><img src="/i/wide.png" alt=""></picture>',
    );
    expect(once).toMatch(
      /<\/i><picture><source [^>]*><img decoding="sync"[^>]*><\/picture><\/span>/,
    );
    expect(twice).toBe(once);
  });

  it('gives a localized video poster a placeholder once', async () => {
    const { stats, once, twice } = await run(
      `<lite-youtube videoid="x" style="background-image: url('/i/wide.png')"><a></a></lite-youtube>`,
    );
    expect(stats.wrapped).toBe(1);
    expect(once).toMatch(/<span class="ph ph--video"><i [^>]*><\/i><lite-youtube /);
    expect(twice).toBe(once);
  });
});
