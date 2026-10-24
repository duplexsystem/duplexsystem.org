import { visit } from 'unist-util-visit';

const LEVELS = new Set(['h2', 'h3', 'h4']);

export function rehypeHeadingAnchors() {
  return () => (tree) => {
    visit(tree, 'element', (node) => {
      if (!LEVELS.has(node.tagName)) return;
      const id = node.properties?.id;
      if (typeof id !== 'string' || id === 'footnote-label') return;
      node.children.push({
        type: 'element',
        tagName: 'a',
        properties: {
          className: ['heading-anchor'],
          href: `#${id}`,
          ariaLabel: 'Link to this section',
          dataPagefindIgnore: '',
        },
        children: [],
      });
    });
  };
}
