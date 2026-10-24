import { describe, expect, it } from 'vitest';
import { rehypeHeadingAnchors } from './heading-anchors.mjs';

const h = (tagName, id, text) => ({
  type: 'element',
  tagName,
  properties: id ? { id } : {},
  children: [{ type: 'text', value: text }],
});

function run(children) {
  const tree = { type: 'root', children };
  rehypeHeadingAnchors()()(tree);
  return tree.children;
}

describe('rehypeHeadingAnchors', () => {
  it('appends an empty self-link to h2-h4 with an id', () => {
    const [h2, h3, h4] = run([h('h2', 'intro', 'Intro'), h('h3', 'a', 'A'), h('h4', 'b', 'B')]);
    for (const node of [h2, h3, h4]) {
      const link = node.children.at(-1);
      expect(link.tagName).toBe('a');
      expect(link.properties.href).toBe(`#${node.properties.id}`);
      expect(link.children).toEqual([]);
    }
  });

  it('skips h1, h5, headings without an id and the footnotes label', () => {
    const nodes = run([
      h('h1', 'title', 'T'),
      h('h5', 'deep', 'D'),
      h('h2', null, 'No id'),
      h('h2', 'footnote-label', 'Footnotes'),
    ]);
    for (const node of nodes) expect(node.children).toHaveLength(1);
  });
});
