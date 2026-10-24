const text = (node) =>
  node.type === 'text' ? node.value : (node.children ?? []).map(text).join('');

const isBlank = (node) => node.type === 'text' && !node.value.trim();

const title = (h) => text(h).trim();

function dropOpening(p, words) {
  const first = p.children[0];
  if (!first || first.type !== 'text') return false;
  const lead = first.value.trimStart();
  if (!lead.toLowerCase().startsWith(words.toLowerCase())) return false;
  const rest = lead.slice(words.length);
  if (rest && !/^[\s,;:]/.test(rest)) return false;
  first.value = rest.replace(/^\s+/, '');
  return true;
}

export function rehypeRunInHeadings() {
  return () => (tree) => {
    const walk = (parent) => {
      const kids = parent.children ?? [];
      for (let i = 0; i < kids.length; i++) {
        const h = kids[i];
        if (h.type !== 'element') continue;
        if (h.tagName !== 'h2') {
          walk(h);
          continue;
        }
        if (h.properties?.id === 'footnote-label') continue;
        let j = i + 1;
        while (j < kids.length && isBlank(kids[j])) j++;
        const p = kids[j];
        if (!p || p.type !== 'element' || p.tagName !== 'p') continue;
        if (!dropOpening(p, title(h))) continue;
        const anchor = h.children.findIndex((c) =>
          c.properties?.className?.includes?.('heading-anchor'),
        );
        if (anchor > 0) h.children.unshift(...h.children.splice(anchor, 1));
        const tight = /^[,;:.!?)]/.test(text(p));
        kids.splice(i, j - i + 1, {
          type: 'element',
          tagName: 'div',
          properties: { className: tight ? ['runin', 'runin--tight'] : ['runin'] },
          children: [h, p],
        });
      }
    };
    walk(tree);
  };
}
