import { visit, SKIP } from 'unist-util-visit';
import { supsubSegments } from '../src/lib/supsub.mjs';

export function remarkSupSub() {
  return (tree) => {
    visit(tree, 'text', (node, index, parent) => {
      if (!parent || index === undefined) return;
      const parts = supsubSegments(node.value);
      if (parts.length === 1 && parts[0].type === 'text') return;
      const nodes = parts.map((p) =>
        p.type === 'text'
          ? { type: 'text', value: p.value }
          : {
              type: p.type === 'sup' ? 'superscript' : 'subscript',
              data: { hName: p.type },
              children: [{ type: 'text', value: p.value }],
            },
      );
      parent.children.splice(index, 1, ...nodes);
      return [SKIP, index + nodes.length];
    });
  };
}
