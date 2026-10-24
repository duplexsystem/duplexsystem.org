import { visit } from 'unist-util-visit';

const LINE = /^\s*Table:((?:\s*(?:title|dir|caption)="[^"]*")+)\s*$/;
const ATTR = /\b(title|dir|caption)="([^"]*)"/g;

export function parseTableMeta(line) {
  const m = LINE.exec(line);
  if (!m) return null;
  const meta = {};
  for (const [, k, v] of m[1].matchAll(ATTR)) meta[k] = v;
  return meta;
}

export function remarkTableMeta() {
  return (tree, file) => {
    const source = String(file.value ?? '');
    const raw = (node) =>
      node.position ? source.slice(node.position.start.offset, node.position.end.offset) : '';
    visit(tree, 'table', (table, index, parent) => {
      let meta = null;
      const last = table.children.at(-1);
      if (table.children.length > 1 && last) {
        meta = parseTableMeta(raw(last).replace(/^\|/, ''));
        if (meta) table.children.pop();
      }
      const next = parent?.children[index + 1];
      if (!meta && next?.type === 'paragraph') {
        meta = parseTableMeta(raw(next));
        if (meta) parent.children.splice(index + 1, 1);
      }
      if (meta && (meta.title || meta.dir || meta.caption)) {
        table.data = table.data ?? {};
        table.data.hProperties = {
          ...table.data.hProperties,
          dataTitle: meta.title,
          dataDir: meta.dir,
          dataCaption: meta.caption,
        };
      }
    });
  };
}
