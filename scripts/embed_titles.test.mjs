import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import fillEmbedTitles from './embed_titles.mjs';

const figure = (id) =>
  `<figure class="frame frame--embed"><span class="frame__label"></span>` +
  `<span class="frame__meta">YouTube</span><lite-youtube videoid="${id}"></lite-youtube></figure>`;

describe('fillEmbedTitles', () => {
  it('writes a title with $ patterns literally and links the source', async () => {
    const dist = await mkdtemp(join(tmpdir(), 'titles-'));
    try {
      await mkdir(join(dist, 'p'));
      await writeFile(join(dist, 'p', 'index.html'), figure('abc'));
      await fillEmbedTitles(dist, async () => "Make $$$ with $& and $' fast");
      const out = await readFile(join(dist, 'p', 'index.html'), 'utf8');
      expect(out).toContain(`<span class="frame__label">Make $$$ with $&amp; and $' fast</span>`);
      expect(out).toContain('<a class="frame__src" href="https://youtube.com/watch?v=abc"');
      expect(out.match(/<figure/g)).toHaveLength(1);
    } finally {
      await rm(dist, { recursive: true, force: true });
    }
  });
});
