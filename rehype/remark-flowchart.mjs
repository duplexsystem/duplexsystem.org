import { dirname, relative } from 'node:path';
import { parse as parseJs } from 'acorn';
import { visit } from 'unist-util-visit';
import { parseFlowchart } from '../src/lib/flowchart.ts';

const ATTR = /\b(title|dir|caption)="([^"]*)"/g;

const importPath = (from, to) => {
  const p = relative(dirname(from), to);
  return p.startsWith('.') ? p : `./${p}`;
};

const attr = (name, value) => ({ type: 'mdxJsxAttribute', name, value });

export function remarkFlowchart({ component }) {
  return () => (tree, file) => {
    let used = false;
    visit(tree, 'code', (node, index, parent) => {
      if (node.lang !== 'flowchart' || !parent || index === undefined) return;
      const meta = Object.fromEntries(
        [...(node.meta ?? '').matchAll(ATTR)].map(([, k, v]) => [k, v]),
      );
      try {
        parseFlowchart(node.value);
      } catch (err) {
        throw new Error(`${file.path}: ${err.message}`);
      }
      parent.children[index] = {
        type: 'mdxJsxFlowElement',
        name: '__Flowchart',
        attributes: [
          attr('title', meta.title ?? 'flowchart'),
          ...(meta.dir ? [attr('dir', meta.dir)] : []),
          ...(meta.caption ? [attr('caption', meta.caption)] : []),
          attr('source', node.value),
        ],
        children: [],
      };
      used = true;
    });
    if (!used) return;
    tree.children.unshift({
      type: 'mdxjsEsm',
      value: '',
      data: {
        estree: parseJs(`import __Flowchart from '${importPath(file.path, component)}';`, {
          ecmaVersion: 'latest',
          sourceType: 'module',
        }),
      },
    });
  };
}
