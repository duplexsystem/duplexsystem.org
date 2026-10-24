import theme from './violet-dark.json' with { type: 'json' };

export const TOKEN_CLASSES = {
  '#5f5573/italic': 't-cm',
  '#c9a5ff': 't-kw',
  '#8fd9a8': 't-st',
  '#7fd4e8': 't-nu',
  '#e6b98a': 't-fn',
  '#877c9c': 't-pu',
  '#ff8888': 't-er',
};

export const PLAIN = (theme.colors?.['editor.foreground'] ?? '').toLowerCase();

function keyOf(style) {
  const color = /(?:^|;)color:(#[0-9a-f]{6})/i.exec(style)?.[1]?.toLowerCase();
  if (!color) return null;
  const italic = /font-style:italic/.test(style);
  return { color, key: italic ? `${color}/italic` : color, italic };
}

export function tokenClasses() {
  return {
    name: 'token-classes',
    line(node) {
      const out = [];
      for (const child of node.children) {
        const style = child.type === 'element' ? child.properties?.style : null;
        const k = typeof style === 'string' ? keyOf(style) : null;
        const rest =
          typeof style === 'string'
            ? style.replace(/(?:^|;)(color:#[0-9a-f]{6}|font-style:italic)/gi, '')
            : '';
        if (!k || rest.replace(/;/g, '').trim()) {
          out.push(child);
          continue;
        }
        if (k.color === PLAIN && !k.italic) {
          out.push(...child.children);
          continue;
        }
        const cls = TOKEN_CLASSES[k.key];
        if (!cls) {
          out.push(child);
          continue;
        }
        delete child.properties.style;
        child.properties.class = cls;
        out.push(child);
      }
      node.children = out.reduce((acc, c) => {
        const prev = acc.at(-1);
        if (c.type === 'text' && prev?.type === 'text') prev.value += c.value;
        else acc.push(c.type === 'text' ? { ...c } : c);
        return acc;
      }, []);
    },
  };
}
