const ATTR = /\b(title|dir|footer)="([^"]*)"/g;
const LINK = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+|\/[^\s)]*)\)$/;

export function linkOf(value) {
  const link = LINK.exec(value ?? '');
  return link && { text: link[1], href: link[2] };
}

export function label(value) {
  const link = linkOf(value);
  if (!link) return [{ type: 'text', value: value ?? '' }];
  return [
    {
      type: 'element',
      tagName: 'a',
      properties: { href: link.href, rel: 'noopener' },
      children: [{ type: 'text', value: link.text }],
    },
  ];
}

export function inlineLabel(value = '') {
  const out = [];
  let at = 0;
  for (const m of value.matchAll(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|\/[^\s)]*)\)/g)) {
    if (m.index > at) out.push({ type: 'text', value: value.slice(at, m.index) });
    out.push({
      type: 'element',
      tagName: 'a',
      properties: { href: m[2], rel: 'noopener' },
      children: [{ type: 'text', value: m[1] }],
    });
    at = m.index + m[0].length;
  }
  if (at < value.length) out.push({ type: 'text', value: value.slice(at) });
  return out;
}

export const withoutHeader = (raw = '') => raw.replace(ATTR, '');

export function parseMeta(raw = '') {
  const attrs = {};
  for (const [, k, v] of raw.matchAll(ATTR)) attrs[k] = v;
  const flags = withoutHeader(raw);
  return {
    title: attrs.title,
    dir: attrs.dir,
    footer: attrs.footer,
    lineNumbers: /\bshowLineNumbers\b/.test(flags),
    runnable: /\brunnable\b/.test(flags),
  };
}

export function codeblockHeader() {
  return {
    name: 'codeblock-header',
    pre(node) {
      const { title, dir, footer, lineNumbers, runnable } = parseMeta(this.options.meta?.__raw);
      if (runnable) this.addClassToHast(node, 'is-runnable');
      if (lineNumbers) {
        this.addClassToHast(node, 'has-line-numbers');
        const digits = String(this.lines?.length ?? this.tokens?.length ?? 0).length;
        node.properties = node.properties ?? {};
        node.properties.style = `${node.properties.style ? `${node.properties.style};` : ''}--ln-digits:${Math.max(digits, 2)}`;
      }
      if (!title && !dir && !footer) return;

      const header = (title || dir) && {
        type: 'element',
        tagName: 'figcaption',
        properties: { class: 'codehead' },
        children: [
          {
            type: 'element',
            tagName: 'span',
            properties: { class: 'codehead__title' },
            children: label(title),
          },
          {
            type: 'element',
            tagName: 'span',
            properties: { class: 'codehead__dir' },
            children: label(dir),
          },
        ],
      };
      return {
        type: 'element',
        tagName: 'figure',
        properties: { class: 'codefig' },
        children: [header, node, footer && codefoot(footer)].filter(Boolean),
      };
    },
  };
}

export function codefoot(footer) {
  return {
    type: 'element',
    tagName: 'footer',
    properties: { class: 'codefoot' },
    children: inlineLabel(footer),
  };
}
