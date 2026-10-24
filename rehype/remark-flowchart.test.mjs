import { describe, expect, it } from 'vitest';
import { remarkFlowchart } from './remark-flowchart.mjs';

const fence = (value, meta = '') => ({
  type: 'root',
  children: [{ type: 'code', lang: 'flowchart', meta, value }],
});

describe('remarkFlowchart', () => {
  const run = (tree) =>
    remarkFlowchart({ component: '/site/src/components/Flowchart.astro' })()(tree, {
      path: '/site/src/content/blog/post.mdx',
    });
  it('turns a fence into <Flowchart> and imports it', () => {
    const tree = fence('A --> B', 'title="a chart" dir="src/a.c" caption="it flows"');
    run(tree);
    const [esm, el] = tree.children;
    expect(esm.data.estree.body[0].source.value).toBe('../../components/Flowchart.astro');
    expect(el.name).toBe('__Flowchart');
    expect(Object.fromEntries(el.attributes.map((a) => [a.name, a.value]))).toEqual({
      title: 'a chart',
      dir: 'src/a.c',
      caption: 'it flows',
      source: 'A --> B',
    });
  });
  it('fails the build on a chart it cannot read, naming the post', () => {
    expect(() => run(fence('A -->'))).toThrow(/post\.mdx.*nothing after it/);
  });
  it('leaves other fences alone', () => {
    const tree = { type: 'root', children: [{ type: 'code', lang: 'c', value: 'x' }] };
    run(tree);
    expect(tree.children).toHaveLength(1);
  });
});
