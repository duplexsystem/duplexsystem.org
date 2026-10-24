import { describe, it, expect } from 'vitest';
import { mathTerms, FENCE, rehypeSearchNames } from './search-names.mjs';
import mathNames from './math-names.json' with { type: 'json' };

const terms = (tex, rendered) => mathTerms(tex, rendered).split(' ').filter(Boolean);

describe('mathTerms', () => {
  it('indexes a command by the name someone would type', () => {
    expect(terms('\\zeta', 'ζ')).toContain('zeta');
  });

  it('indexes a symbol by its Unicode name, so plain English finds it', () => {
    expect(terms('\\sum', '∑')).toContain('summation');
  });

  it('drops layout commands, which would match unrelated queries', () => {
    const out = terms('\\begin{aligned} \\left( \\text{x} \\right) \\end{aligned}', '');
    expect(out).not.toContain('begin');
    expect(out).not.toContain('text');
    expect(out).not.toContain('left');
  });

  it('drops the words Unicode uses to classify rather than name', () => {
    const out = terms('', 'ζ');
    expect(out).not.toContain('greek');
    expect(out).not.toContain('letter');
    expect(out).toContain('zeta');
  });

  it('does not repeat a term reachable both ways', () => {
    const out = terms('\\pi', 'π');
    expect(out.filter((w) => w === 'pi')).toHaveLength(1);
  });

  it('returns nothing for an expression with neither commands nor symbols', () => {
    expect(mathTerms('x + 1', 'x+1')).toBe('');
  });
});

describe('FENCE', () => {
  it('is a character no KaTeX font can draw', () => {
    expect(mathNames[FENCE]).toBeUndefined();
  });
});

describe('rehypeSearchNames emoji', () => {
  const el = (tagName, children, properties = {}) => ({
    type: 'element',
    tagName,
    properties,
    children,
  });
  const text = (value) => ({ type: 'text', value });
  const run = (...children) => {
    const tree = { type: 'root', children };
    rehypeSearchNames()()(tree);
    return JSON.stringify(tree);
  };

  it('labels an emoji in prose', () => {
    expect(run(el('p', [text('hi 😀')]))).toContain('"title":"grinning face"');
  });

  it('leaves emoji in code alone, however deep the highlighter nests it', () => {
    const inline = run(el('p', [el('code', [text('😀')])]));
    const block = run(el('pre', [el('code', [el('span', [text('x = "😀"')])])]));
    expect(inline).not.toContain('emoji');
    expect(block).not.toContain('emoji');
  });
});
