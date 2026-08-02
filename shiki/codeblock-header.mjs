const ATTR = /(\w+)="([^"]*)"/g;

function parseMeta(raw = '') {
  const attrs = {};
  for (const [, k, v] of raw.matchAll(ATTR)) attrs[k] = v;
  return {
    title: attrs.title,
    dir: attrs.dir,
    lineNumbers: /\bshowLineNumbers\b/.test(raw),
  };
}

export function codeblockHeader() {
  return {
    name: 'codeblock-header',
    pre(node) {
      const { title, dir, lineNumbers } = parseMeta(this.options.meta?.__raw);
      if (lineNumbers) {
        this.addClassToHast(node, 'has-line-numbers');
        // Gutter sized by its widest number, like GitHub. A fixed width
        // overflows into the rule beside it past 99 lines.
        const digits = String(this.lines?.length ?? this.tokens?.length ?? 0).length;
        node.properties = node.properties ?? {};
        node.properties.style = `${node.properties.style ? `${node.properties.style};` : ''}--ln-digits:${Math.max(digits, 2)}`;
      }
      if (!title && !dir) return;

      const header = {
        type: 'element',
        tagName: 'figcaption',
        properties: { class: 'codehead' },
        children: [
          {
            type: 'element',
            tagName: 'span',
            properties: { class: 'codehead__title' },
            children: [{ type: 'text', value: title ?? '' }],
          },
          {
            type: 'element',
            tagName: 'span',
            properties: { class: 'codehead__dir' },
            children: [{ type: 'text', value: dir ?? '' }],
          },
        ],
      };
      return {
        type: 'element',
        tagName: 'figure',
        properties: { class: 'codefig' },
        children: [header, node],
      };
    },
  };
}
