import { visit } from 'unist-util-visit';
import punctWidths from './punct-widths.json' with { type: 'json' };

const has = (node, name) =>
  node?.type === 'element' &&
  Array.isArray(node.properties?.className) &&
  node.properties.className.includes(name);

const shown = (value, hang = 0) => ({
  type: 'element',
  tagName: 'span',
  properties: hang
    ? { className: ['math-punct'], style: `margin-right:-${hang}em` }
    : { className: ['math-punct'] },
  children: [{ type: 'text', value }],
});

const widened = (space, hang) => ({
  type: 'element',
  tagName: 'span',
  properties: { style: `word-spacing:${hang}em` },
  children: [{ type: 'text', value: space }],
});

const widthOf = (marks, widths) => {
  let em = 0;
  for (const ch of marks) {
    if (!(ch in widths)) return 0;
    em += widths[ch];
  }
  return Math.round(em * 1000) / 1000;
};

const spoken = (value) => ({
  type: 'element',
  tagName: 'span',
  properties: { className: ['vh', 'math-punct-sr'] },
  children: [{ type: 'text', value }],
});

export function rehypeMathNowrap({ widths = punctWidths } = {}) {
  return () => (tree) => {
    visit(tree, 'element', (parent) => {
      const kids = parent.children;
      for (let i = 0; i < kids.length; i++) {
        const node = kids[i];
        if (!has(node, 'katex') || (parent.tagName === 'span' && has(parent, 'katex-display')))
          continue;
        const html = node.children.find((c) => has(c, 'katex-html'));
        const pieces = html?.children.filter((c) => has(c, 'katex-base')) ?? [];
        if (pieces.length === 0) continue;

        const next = kids[i + 1];
        const trail = next?.type === 'text' ? /^\S+/.exec(next.value)?.[0] : undefined;
        if (trail) {
          next.value = next.value.slice(trail.length);
          const space = /^\s/.exec(next.value)?.[0];
          const hang = space || !next.value ? widthOf(trail, widths) : 0;
          pieces.at(-1).children.push(shown(trail, hang));
          const after = [spoken(trail)];
          if (hang && space) {
            next.value = next.value.slice(1);
            after.push(widened(' ', hang));
          }
          kids.splice(i + 1, next.value ? 0 : 1, ...after);
        }

        const prev = kids[i - 1];
        const lead = prev?.type === 'text' ? /\S+$/.exec(prev.value)?.[0] : undefined;
        if (lead) {
          prev.value = prev.value.slice(0, -lead.length);
          pieces[0].children.unshift(shown(lead));
          if (prev.value) kids.splice(i, 0, spoken(lead));
          else kids.splice(i - 1, 1, spoken(lead));
          i++;
        }
      }
    });
  };
}
