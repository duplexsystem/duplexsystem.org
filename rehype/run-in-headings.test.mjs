import { describe, expect, it } from 'vitest';
import { rehypeRunInHeadings } from './run-in-headings.mjs';

const el = (tagName, children, properties = {}) => ({
  type: 'element',
  tagName,
  properties,
  children,
});
const t = (value) => ({ type: 'text', value });

function run(children) {
  const tree = { type: 'root', children };
  rehypeRunInHeadings()()(tree);
  return tree.children;
}

describe('rehypeRunInHeadings', () => {
  it('leaves a heading alone when its paragraph starts afresh', () => {
    const nodes = run([
      el('h2', [t('My first version')], { id: 'my-first-version' }),
      t('\n'),
      el('p', [t('At the suggestion of a friend…')]),
    ]);
    expect(nodes.map((n) => n.tagName ?? n.type)).toEqual(['h2', 'text', 'p']);
    expect(nodes[2].children[0].value).toBe('At the suggestion of a friend…');
  });

  it('runs in a heading its paragraph carries on from, dropping the repeat', () => {
    const [div] = run([
      el('h2', [t('Back in 2021')], { id: 'back-in-2021' }),
      el('p', [t('Back in 2021 I was attempting…')]),
    ]);
    expect(div).toMatchObject({ tagName: 'div', properties: { className: ['runin'] } });
    expect(div.children[0].properties.id).toBe('back-in-2021');
    expect(div.children[1].children[0].value).toBe('I was attempting…');
  });

  it('only counts whole words', () => {
    const nodes = run([el('h2', [t('Back in 20')]), el('p', [t('Back in 2021 I was…')])]);
    expect(nodes.map((n) => n.tagName)).toEqual(['h2', 'p']);
    expect(nodes[1].children[0].value).toBe('Back in 2021 I was…');
  });

  it('leaves a heading followed by anything but a paragraph on its own line', () => {
    const nodes = run([el('h2', [t('Charts')]), el('figure', [])]);
    expect(nodes.map((n) => n.tagName)).toEqual(['h2', 'figure']);
  });

  it('leaves the footnotes heading alone', () => {
    const nodes = run([el('h2', [t('Footnotes')], { id: 'footnote-label' }), el('p', [t('x')])]);
    expect(nodes.map((n) => n.tagName)).toEqual(['h2', 'p']);
  });

  it('runs in only the headings their paragraphs carry on from', () => {
    const nodes = run([
      el('h2', [t('A start')]),
      el('p', [t('A start, and on')]),
      el('p', [t('more')]),
      el('h2', [t('B')]),
      el('p', [t('Fresh text')]),
    ]);
    expect(nodes.map((n) => n.tagName)).toEqual(['div', 'p', 'h2', 'p']);
  });
  it('moves the self-link to the front, to hang in the margin', () => {
    const anchor = el('a', [], { className: ['heading-anchor'], href: '#a' });
    const [div] = run([el('h2', [t('A'), anchor], { id: 'a' }), el('p', [t('A and on')])]);
    expect(div.children[0].children[0]).toBe(anchor);
  });
  it('sets punctuation right against the heading, with no gap', () => {
    const [div] = run([
      el('h2', [t("There's one more thing")]),
      el('p', [t("There's one more thing, which I only found…")]),
    ]);
    expect(div.properties.className).toEqual(['runin', 'runin--tight']);
    expect(div.children[1].children[0].value).toBe(', which I only found…');
  });
});
