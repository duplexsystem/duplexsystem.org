import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  GateError,
  attrsOf,
  embedFigureSpans,
  htmlPages,
  openTags,
  stripEmbedFigures,
} from './gates.mjs';

describe('openTags and attrsOf', () => {
  it('ends a tag at the first ">" outside quotes', () => {
    const [tag] = [...openTags('<img alt="a -> b" src=\'/x.png\' hidden>')];
    expect(tag.name).toBe('img');
    expect([...attrsOf(tag.text)]).toEqual([
      ['alt', 'a -> b'],
      ['src', '/x.png'],
    ]);
  });

  it('keeps data-type apart from type and lets the first duplicate win', () => {
    const attrs = attrsOf('<script data-type="x" type=module type="y">');
    expect(attrs.get('type')).toBe('module');
    expect(attrs.get('data-type')).toBe('x');
  });
});

describe('embedFigureSpans', () => {
  it('terminates on an unclosed embed figure and runs it to the end', () => {
    const html = 'a<figure class="frame--embed"><p>x';
    expect(embedFigureSpans(html)).toEqual([[1, html.length]]);
    expect(stripEmbedFigures(html)).toBe('a');
  });
});

describe('htmlPages', () => {
  it('throws when no page matches', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gates-'));
    try {
      await mkdir(join(dir, 'x'));
      await writeFile(join(dir, 'x', 'a.txt'), '');
      await expect(htmlPages(dir)[Symbol.asyncIterator]().next()).rejects.toBeInstanceOf(GateError);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('yields matching pages with their dist-relative path', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gates-'));
    try {
      await mkdir(join(dir, 'blog'));
      await writeFile(join(dir, 'blog', 'index.html'), '<p>hi</p>');
      await writeFile(join(dir, 'index.html'), '');
      const seen = [];
      for await (const p of htmlPages(dir, (rel) => rel.startsWith('blog/')))
        seen.push([p.rel, p.html]);
      expect(seen).toEqual([['blog/index.html', '<p>hi</p>']]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
