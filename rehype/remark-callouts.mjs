import { visit } from 'unist-util-visit';

const KINDS = { note: 'Note', tip: 'Tip', warning: 'Warning', caution: 'Caution' };
const MARKER = /^\[!(note|tip|warning|caution)\][ \t]*([^\n]*)(?:\n|$)/i;

const el = (hName, className, children, extra = {}) => ({
  type: 'callout',
  data: { hName, hProperties: { className, ...extra } },
  children,
});

export function remarkCallouts() {
  return () => (tree) => {
    visit(tree, 'blockquote', (node) => {
      const first = node.children[0];
      const text = first?.type === 'paragraph' ? first.children[0] : null;
      if (text?.type !== 'text') return;
      const m = MARKER.exec(text.value);
      if (!m) return;
      const kind = m[1].toLowerCase();
      const label = m[2].trim() || KINDS[kind];

      text.value = text.value.slice(m[0].length);
      if (!text.value) first.children.shift();
      if (first.children[0]?.type === 'break') first.children.shift();
      if (first.children.length === 0) node.children.shift();

      const bar = el(
        'div',
        ['frame__bar', 'callout__bar'],
        [
          el('span', ['callout__icon'], [], { ariaHidden: 'true' }),
          el('span', ['frame__label'], [{ type: 'text', value: label }]),
        ],
      );
      const body = el('div', ['frame__body', 'callout__body'], node.children);
      node.data = {
        hName: 'div',
        hProperties: { className: ['frame', 'callout', `callout--${kind}`], role: 'note' },
      };
      node.children = [bar, body];
    });
  };
}
