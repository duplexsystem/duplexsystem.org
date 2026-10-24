import { visit, SKIP } from 'unist-util-visit';
import emojiData from 'unicode-emoji-json';
import mathNames from './math-names.json' with { type: 'json' };

const EMOJI = Object.keys(emojiData).sort((a, b) => b.length - a.length);
const EMOJI_RE = new RegExp(
  `(${EMOJI.map((e) => e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`,
  'gu',
);

const SKIP_TAGS = new Set(['code', 'pre', 'kbd', 'samp', 'script', 'style']);

export const FENCE = '\u00a4';

const classes = (node) => node.properties?.className ?? [];
const hasClass = (node, name) => classes(node).includes(name);

function textOf(node) {
  let out = '';
  visit(node, 'text', (child) => {
    out += child.value;
  });
  return out;
}

const LAYOUT = new Set([
  'begin',
  'end',
  'left',
  'right',
  'text',
  'textrm',
  'textit',
  'textbf',
  'mathbf',
  'mathrm',
  'mathit',
  'mathsf',
  'mathtt',
  'mathnormal',
  'quad',
  'qquad',
  'hspace',
  'vspace',
  'limits',
  'nolimits',
  'displaystyle',
  'textstyle',
  'scriptstyle',
  'big',
  'bigg',
  'Big',
  'Bigg',
]);
const GENERIC = new Set([
  'greek',
  'latin',
  'small',
  'capital',
  'letter',
  'sign',
  'symbol',
  'mark',
  'ary',
  'n',
  'no',
  'break',
  'space',
  'with',
  'and',
  'or',
  'above',
  'below',
  'operator',
  'character',
]);

export function mathTerms(tex, rendered) {
  const terms = new Set();
  for (const command of tex.match(/\\[a-zA-Z]+/g) ?? []) {
    const name = command.slice(1);
    if (!LAYOUT.has(name)) terms.add(name.toLowerCase());
  }
  for (const char of rendered) {
    const name = mathNames[char];
    if (!name) continue;
    for (const word of name.split(/[\s-]+/)) {
      if (word && !GENERIC.has(word)) terms.add(word);
    }
  }
  return [...terms].join(' ');
}

export function rehypeSearchNames() {
  return function attacher() {
    return function transformer(tree) {
      visit(tree, 'element', (node) => {
        if (!hasClass(node, 'katex')) return;

        let tex = '';
        let rendered = '';
        visit(node, 'element', (child) => {
          if (child.tagName === 'annotation') tex = textOf(child);
          if (hasClass(child, 'katex-html')) rendered = textOf(child);
          if (child.tagName === 'math') child.properties['data-pagefind-ignore'] = '';
        });

        const terms = mathTerms(tex, rendered);
        if (!terms) return SKIP;
        node.properties['data-pagefind-index-attrs'] = 'data-terms';
        node.properties['data-terms'] = `${FENCE}${terms}${FENCE}`;
        return SKIP;
      });

      visit(tree, (node, index, parent) => {
        if (node.type === 'element' && (SKIP_TAGS.has(node.tagName) || hasClass(node, 'katex'))) {
          return SKIP;
        }
        if (node.type !== 'text' || !parent || index === null) return;
        if (!EMOJI_RE.test(node.value)) return;
        EMOJI_RE.lastIndex = 0;

        const parts = node.value.split(EMOJI_RE).filter((s) => s !== '');
        const out = [];
        for (const part of parts) {
          const entry = emojiData[part];
          if (!entry) {
            out.push({ type: 'text', value: part });
            continue;
          }
          out.push({
            type: 'element',
            tagName: 'span',
            properties: {
              className: ['emoji'],
              'data-pagefind-index-attrs': 'title',
              title: entry.name,
            },
            children: [{ type: 'text', value: part }],
          });
        }
        parent.children.splice(index, 1, ...out);
        return [SKIP, index + out.length];
      });
    };
  };
}
