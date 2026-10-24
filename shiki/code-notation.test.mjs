import { describe, expect, it } from 'vitest';
import { codeToHtml } from 'shiki';
import { codeNotation, runnableSource } from './code-notation.mjs';

describe('runnableSource', () => {
  it('drops removed lines and the notation', () => {
    expect(runnableSource('int x;\nreturn a; // [!code --]\nreturn b; // [!code ++]\n')).toBe(
      'int x;\nreturn b;\n',
    );
  });
  it('drops a removed range, and reads assembly and block comments', () => {
    expect(
      runnableSource('a // [!code --:2]\nb\nc /* [!code hl] */\nret ; [!code ++]\nd ; kept'),
    ).toBe('c\nret\nd ; kept');
  });
});

describe('codeNotation', () => {
  it('classes the lines and the block, and keeps no notation', async () => {
    const html = await codeToHtml('a // [!code --]\nb // [!code ++]\nc', {
      lang: 'c',
      theme: 'github-dark',
      meta: { __raw: '{3}' },
      transformers: codeNotation(),
    });
    expect(html).toMatch(/<pre class="[^"]*\bhas-diff\b/);
    const lines = [...html.matchAll(/<span class="line([^"]*)"/g)].map((m) => m[1].trim());
    expect(lines).toEqual(['diff remove', 'diff add', 'highlighted']);
    expect(html).not.toContain('[!code');
  });
});
