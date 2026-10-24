import { describe, expect, it } from 'vitest';
import { codeblockHeader, linkOf, parseMeta, withoutHeader } from './codeblock-header.mjs';

describe('parseMeta', () => {
  it('reads title, dir and flags', () => {
    expect(parseMeta('title="a.c" dir="src" showLineNumbers runnable')).toEqual({
      title: 'a.c',
      dir: 'src',
      lineNumbers: true,
      runnable: true,
    });
  });

  it('does not read a flag out of a title or dir', () => {
    const meta = parseMeta('title="a runnable showLineNumbers demo" dir="runnable"');
    expect(meta.runnable).toBe(false);
    expect(meta.lineNumbers).toBe(false);
  });
});

describe('codeblockHeader', () => {
  it('does not mark a block runnable because its title says so', () => {
    const added = [];
    const ctx = {
      options: { meta: { __raw: 'title="a runnable demo"' } },
      addClassToHast: (_, c) => added.push(c),
    };
    codeblockHeader().pre.call(ctx, { properties: {} });
    expect(added).toEqual([]);
  });
});

describe('linkOf', () => {
  it('takes http(s) and site-relative links only', () => {
    expect(linkOf('[a](https://x.org/y)')).toEqual({ text: 'a', href: 'https://x.org/y' });
    expect(linkOf('[a](/blog/)')).toEqual({ text: 'a', href: '/blog/' });
    expect(linkOf('[a](javascript:alert(1))')).toBe(null);
    expect(linkOf(undefined)).toBe(null);
  });
});

describe('withoutHeader', () => {
  it('drops title and dir, keeping the rest', () => {
    expect(withoutHeader('title="a" showLineNumbers dir="b" run="f(1)"').replace(/\s+/g, ' ')).toBe(
      ' showLineNumbers run="f(1)"'.replace(/\s+/g, ' '),
    );
  });
});

describe('footer', () => {
  it('reads footer from the meta, and drops it with the header', async () => {
    const { parseMeta, withoutHeader, inlineLabel } = await import('./codeblock-header.mjs');
    expect(parseMeta('title="a.c" footer="[MIT](https://x/m)"').footer).toBe('[MIT](https://x/m)');
    expect(withoutHeader('title="a" footer="b" showLineNumbers').trim()).toBe('showLineNumbers');
    expect(inlineLabel('Public domain, see [README](https://x/r).')).toEqual([
      { type: 'text', value: 'Public domain, see ' },
      {
        type: 'element',
        tagName: 'a',
        properties: { href: 'https://x/r', rel: 'noopener' },
        children: [{ type: 'text', value: 'README' }],
      },
      { type: 'text', value: '.' },
    ]);
    expect(inlineLabel('[x](javascript:alert(1))')).toEqual([
      { type: 'text', value: '[x](javascript:alert(1))' },
    ]);
  });
});
