import { describe, expect, it } from 'vitest';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import rehypeStringify from 'rehype-stringify';
import { remarkCallouts } from './remark-callouts.mjs';

const render = (md) =>
  String(
    unified()
      .use(remarkParse)
      .use(remarkCallouts())
      .use(remarkRehype)
      .use(rehypeStringify)
      .processSync(md),
  );

describe('remarkCallouts', () => {
  it('turns a marked blockquote into a window', () => {
    const html = render('> [!WARNING]\n> `x` is undefined.');
    expect(html).toBe(
      '<div class="frame callout callout--warning" role="note">\n' +
        '<div class="frame__bar callout__bar"><span class="callout__icon" aria-hidden="true"></span>' +
        '<span class="frame__label">Warning</span></div>\n' +
        '<div class="frame__body callout__body"><p><code>x</code> is undefined.</p></div>\n</div>',
    );
  });

  it('takes a label from the marker line, in any case', () => {
    const html = render('> [!note] Compilers\n> gcc and clang.');
    expect(html).toContain('callout--note');
    expect(html).toContain('<span class="frame__label">Compilers</span>');
    expect(html).toContain('<p>gcc and clang.</p>');
  });

  it('keeps every paragraph of the body', () => {
    const html = render('> [!TIP]\n>\n> One.\n>\n> Two.');
    expect(html.match(/<p>/g)).toHaveLength(2);
    expect(html).not.toContain('[!TIP]');
  });

  it('leaves other blockquotes alone', () => {
    expect(render('> Just a quote.')).toBe('<blockquote>\n<p>Just a quote.</p>\n</blockquote>');
    expect(render('> [!UNKNOWN]\n> x')).toContain('<blockquote>');
  });
});
