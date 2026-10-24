import { describe, expect, it } from 'vitest';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeStringify from 'rehype-stringify';
import { remarkSupSub } from './remark-supsub.mjs';
import { supsubHtml, supsubPlain } from '../src/lib/supsub.mjs';

const md = (s) =>
  String(
    unified()
      .use(remarkParse)
      .use(remarkGfm, { singleTilde: false })
      .use(remarkSupSub)
      .use(remarkRehype)
      .use(rehypeStringify)
      .processSync(s),
  ).trim();

describe('remarkSupSub', () => {
  it('makes superscripts and subscripts', () => {
    expect(md('10^16^ and H~2~O')).toBe('<p>10<sup>16</sup> and H<sub>2</sub>O</p>');
  });

  it('keeps double-tilde strikethrough', () => {
    expect(md('~~gone~~ and x~i~')).toBe('<p><del>gone</del> and x<sub>i</sub></p>');
  });

  it('leaves a lone caret or tilde and spaced runs alone', () => {
    expect(md('2^53 is about ~9e15, and a ^b c^ d')).toBe(
      '<p>2^53 is about ~9e15, and a ^b c^ d</p>',
    );
  });

  it('does not touch code or footnote references', () => {
    expect(md('`x^2^` and note[^1]\n\n[^1]: hi')).toContain('<code>x^2^</code>');
  });

  it('works inside emphasis and links', () => {
    expect(md('*e^x^* [10^3^](https://a.b/^x^)')).toBe(
      '<p><em>e<sup>x</sup></em> <a href="https://a.b/%5Ex%5E">10<sup>3</sup></a></p>',
    );
  });
});

describe('supsub strings', () => {
  it('renders escaped HTML', () => {
    expect(supsubHtml('2^53^ < 10^16^ & x~i~')).toBe(
      '2<sup>53</sup> &lt; 10<sup>16</sup> &amp; x<sub>i</sub>',
    );
  });

  it('drops markers for plain text', () => {
    expect(supsubPlain('2^53^ and H~2~O')).toBe('253 and H2O');
  });
});
