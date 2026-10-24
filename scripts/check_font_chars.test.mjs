import { describe, expect, it } from 'vitest';
import { unlocked } from './check_font_chars.mjs';
import {
  cssRules,
  familyList,
  matchWeight,
  pageFontChars,
  parseRanges,
} from './lib/font-usage.mjs';

const FACES = [
  { key: 'lit-400', family: 'Literata', style: 'normal', weight: 400, covers: 'U+0020-007E' },
  { key: 'lit-700', family: 'Literata', style: 'normal', weight: 700, covers: 'U+0020-007E' },
  { key: 'lit-i400', family: 'Literata', style: 'italic', weight: 400, covers: 'U+0020-007E' },
  { key: 'jb', family: 'JetBrains Mono', style: 'normal', weight: 400, covers: 'U+0020-007E' },
  { key: 'jb-i', family: 'JetBrains Mono', style: 'italic', weight: 400, covers: 'U+0020-007E' },
  {
    key: 'emoji',
    family: 'Noto Emoji',
    style: 'normal',
    weight: 400,
    covers: 'U+200D,U+2600-27BF,U+FE0F,U+1F000-1FAFF',
  },
  {
    key: 'katex-main',
    family: 'KaTeX_Main',
    style: 'normal',
    weight: 400,
    covers: 'U+0020-007E,U+2211',
  },
];
const CSS = `
  :root { --font-literata: Literata-0123456789abcdef, "Literata-0123456789abcdef fallback: Times New Roman", Georgia, serif; }
  body { font-family: var(--font-literata), 'Noto Emoji', serif; }
  code { font-family: 'JetBrains Mono', monospace; }
  .t-cm { font-style: italic; }
  .katex { font: normal 1.21em KaTeX_Main, Times New Roman, serif; }
  .mark::after { content: '+' / 'added'; font-weight: 700; }
  @media print { body { font-family: serif; } }
`;
const page = (body) =>
  pageFontChars(`<html><body>${body}</body></html>`, cssRules([CSS]), FACES).chars;
const flat = (m) => Object.fromEntries([...m].map(([k, v]) => [k, [...v].sort().join('')]));

describe('check_font_chars', () => {
  it('lists, per face, the characters its lock lacks', () => {
    expect([...unlocked(new Map([['lit-400', new Set(['a', 'b'])]]), { 'lit-400': 'a' })]).toEqual([
      ['lit-400', ['b']],
    ]);
  });
});

describe('font-usage', () => {
  it('expands var() and reads Astro family names', () => {
    expect(
      familyList(
        'var(--f), "Noto Emoji", serif',
        new Map([['--f', 'Literata-0123456789abcdef, Georgia']]),
      ),
    ).toEqual(['Literata', 'Georgia', 'Noto Emoji', 'serif']);
    expect(parseRanges('U+0041-0043,U+2026')).toEqual(new Set([0x41, 0x42, 0x43, 0x2026]));
  });
  it('follows the cascade, inheritance and the browser defaults', () => {
    expect(
      flat(page('<p>ab <b>c</b> <em>d</em> <code>e<span class="t-cm">f</span></code></p>')),
    ).toEqual({
      'lit-400': ' ab',
      'lit-700': 'c',
      'lit-i400': 'd',
      jb: 'e',
      'jb-i': 'f',
    });
  });
  it('gives each grapheme to the first face that draws it: emoji to Noto Emoji, math to KaTeX', () => {
    expect(flat(page('<p>a🦀 🏳️‍⚧️</p><span class="katex">x∑</span>'))).toEqual({
      'lit-400': ' a',
      emoji: [...'\u200d\u26a7\u{1f3f3}\u{1f980}\ufe0f'].sort().join(''),
      'katex-main': 'x∑',
    });
  });
  it('reads ::before/::after content, not its alt text, and skips hidden text', () => {
    expect(flat(page('<span class="mark">x</span><span hidden>zz</span>'))).toEqual({
      'lit-400': 'x',
      'lit-700': '+',
    });
  });
  it('matches weights the way CSS does', () => {
    expect(matchWeight(500, [400, 600, 700])).toBe(400);
    expect(matchWeight(650, [400, 600, 700])).toBe(700);
    expect(matchWeight(300, [400, 600, 700])).toBe(400);
  });
});
