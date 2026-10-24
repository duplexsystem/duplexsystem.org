import { describe, expect, it } from 'vitest';
import { rehypeFrame } from './frame.mjs';

const run = (tree, options) => rehypeFrame(options)()(tree);
const embed = (name) => ({
  type: 'root',
  children: [{ type: 'mdxJsxFlowElement', name, attributes: [], children: [] }],
});

describe('rehypeFrame embeds', () => {
  it('frames a known platform component', () => {
    const tree = embed('YouTube');
    run(tree);
    expect(tree.children[0].tagName).toBe('figure');
  });

  it('does not treat Object.prototype keys as platforms', () => {
    for (const name of ['constructor', 'toString', 'hasOwnProperty']) {
      const tree = embed(name);
      run(tree);
      expect(tree.children[0].type).toBe('mdxJsxFlowElement');
    }
  });
});

describe('rehypeFrame tables', () => {
  const table = (properties) => ({
    type: 'root',
    children: [{ type: 'element', tagName: 'table', properties, children: [] }],
  });
  it('puts a caption under the table, with code and superscripts', () => {
    const tree = table({ dataTitle: 't', dataCaption: 'best of `9` runs, up to 10^19^' });
    run(tree);
    const fig = tree.children[0];
    const cap = fig.children.at(-1);
    expect(cap.tagName).toBe('figcaption');
    expect(cap.children.map((c) => c.tagName ?? c.value)).toEqual([
      'best of ',
      'code',
      ' runs, up to 10',
      'sup',
    ]);
    expect(fig.children[0].properties.className).toEqual(['frame__bar']);
  });
  it('adds no caption when none is set', () => {
    const tree = table({ dataTitle: 't' });
    run(tree);
    expect(tree.children[0].children.some((c) => c.tagName === 'figcaption')).toBe(false);
  });
});
