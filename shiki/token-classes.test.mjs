import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import theme from './violet-dark.json' with { type: 'json' };
import { PLAIN, TOKEN_CLASSES, tokenClasses } from './token-classes.mjs';

const css = readFileSync(new URL('../src/styles/base.css', import.meta.url), 'utf8');

describe('token classes', () => {
  it('covers every colour the theme gives a token, with a matching CSS rule', () => {
    for (const r of theme.tokenColors) {
      const fg = r.settings?.foreground?.toLowerCase();
      if (!fg || fg === PLAIN) continue;
      const key = /italic/.test(r.settings.fontStyle ?? '') ? `${fg}/italic` : fg;
      const cls = TOKEN_CLASSES[key];
      expect(cls, key).toBeTruthy();
      const rule = new RegExp(`pre \\.${cls} \\{[^}]*color: ${fg};`);
      expect(css, `${cls} in base.css`).toMatch(rule);
    }
  });

  it('swaps colour styles for classes and unwraps plain text', () => {
    const span = (style, value) => ({
      type: 'element',
      tagName: 'span',
      properties: { style },
      children: [{ type: 'text', value }],
    });
    const line = {
      type: 'element',
      tagName: 'span',
      properties: { class: 'line' },
      children: [
        span('color:#C9A5FF', 'int'),
        span(`color:${PLAIN.toUpperCase()}`, ' x'),
        span(`color:${PLAIN}`, ' ='),
        span('color:#5F5573;font-style:italic', '// hi'),
        span('color:#C9A5FF;background:red', 'odd'),
      ],
    };
    tokenClasses().line(line);
    const out = line.children.map((c) =>
      c.type === 'text'
        ? `text:${c.value}`
        : `${c.properties.class ?? ''}|${c.properties.style ?? ''}`,
    );
    expect(out).toEqual(['t-kw|', 'text: x =', 't-cm|', '|color:#C9A5FF;background:red']);
  });
});
