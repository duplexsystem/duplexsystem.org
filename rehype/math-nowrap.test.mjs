import { describe, expect, it } from 'vitest';
import { rehypeMathNowrap } from './math-nowrap.mjs';

const el = (className, children = []) => ({
  type: 'element',
  tagName: 'span',
  properties: { className: [className] },
  children,
});
const text = (value) => ({ type: 'text', value });
const math = () =>
  el('katex', [
    el('katex-mathml', [text('x')]),
    el('katex-html', [el('katex-base', [text('a')]), el('katex-base', [text('b')])]),
  ]);

const widths = { '.': 0.333, ',': 0.328, ')': 0.332 };

function run(children) {
  const p = { type: 'element', tagName: 'p', properties: {}, children };
  rehypeMathNowrap({ widths })()({ type: 'root', children: [p] });
  return p.children;
}
const pieces = (k) => k.children[1].children;
const flat = (n) => (n.type === 'text' ? n.value : n.children.map(flat).join(''));
const kind = (n) =>
  n.type === 'text'
    ? `"${n.value}"`
    : (n.properties.className?.join('+') ?? `style(${n.properties.style})`);

describe('rehypeMathNowrap', () => {
  it('moves a trailing full stop into the last piece', () => {
    const out = run([text('so '), math(), text('. Next')]);
    expect(out.map(kind)).toEqual([
      '"so "',
      'katex',
      'vh+math-punct-sr',
      'style(word-spacing:0.333em)',
      '"Next"',
    ]);
    expect(flat(pieces(out[1]).at(-1))).toBe('b.');
    expect(flat(out[2])).toBe('.');
  });

  it('moves an opening bracket into the first piece', () => {
    const out = run([text('as ('), math(), text('), then')]);
    expect(flat(pieces(out[2])[0])).toBe('(a');
    expect(flat(pieces(out[2]).at(-1))).toBe('b),');
    expect(out.map(kind)).toEqual([
      '"as "',
      'vh+math-punct-sr',
      'katex',
      'vh+math-punct-sr',
      'style(word-spacing:0.66em)',
      '"then"',
    ]);
  });

  it('leaves a formula with spaces on both sides alone', () => {
    const out = run([text('a '), math(), text(' b')]);
    expect(out.map(kind)).toEqual(['"a "', 'katex', '" b"']);
    expect(flat(pieces(out[1]).at(-1))).toBe('b');
  });

  it('drops a text node it empties', () => {
    const out = run([math(), text('.')]);
    expect(out.map(kind)).toEqual(['katex', 'vh+math-punct-sr']);
  });

  it('handles two formulas in one paragraph', () => {
    const out = run([math(), text(' and '), math(), text('.')]);
    expect(out.map(kind)).toEqual(['katex', '" and "', 'katex', 'vh+math-punct-sr']);
  });

  it('leaves display math alone', () => {
    const display = el('katex-display', [math(), text('.')]);
    run([display]);
    expect(display.children.map(kind)).toEqual(['katex', '"."']);
  });

  it('hangs trailing punctuation by its own width', () => {
    const out = run([math(), text('. Next')]);
    const punct = pieces(out[0]).at(-1).children.at(-1);
    expect(punct.properties.style).toBe('margin-right:-0.333em');
    expect(flat(out[2])).toBe(' ');
  });

  it('hangs at the end of a block, with no space to widen', () => {
    const out = run([math(), text('.')]);
    expect(pieces(out[0]).at(-1).children.at(-1).properties.style).toBe('margin-right:-0.333em');
  });

  it('does not hang mid-word or with an unmeasured mark', () => {
    const midWord = run([math(), text('-th place')]);
    expect(pieces(midWord[0]).at(-1).children.at(-1).properties.style).toBeUndefined();
    const unknown = run([math(), text('?! wow')]);
    expect(pieces(unknown[0]).at(-1).children.at(-1).properties.style).toBeUndefined();
    expect(unknown.map(kind)).toEqual(['katex', 'vh+math-punct-sr', '" wow"']);
  });

  it('does not hang leading punctuation', () => {
    const out = run([text('('), math(), text(' x')]);
    expect(pieces(out[1])[0].children[0].properties.style).toBeUndefined();
  });
});
