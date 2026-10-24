import { describe, it, expect } from 'vitest';
import { readingTime, cognitiveComplexity } from './reading-time';

const words = (n: number, word = 'house') => Array(n).fill(word).join(' ');

describe('readingTime word counting', () => {
  it('counts plain words', () => {
    expect(readingTime('one two three four five').words).toBe(5);
  });

  it('ignores fenced code when counting prose words', () => {
    const md = 'one two\n\n```js\nconst a = 1;\n```\n\nthree';
    expect(readingTime(md).words).toBe(3);
  });

  it('keeps link text but drops the URL', () => {
    expect(readingTime('a [link](https://example.com) here').words).toBe(3);
  });

  it('treats a hyphenated compound as one word', () => {
    expect(readingTime('hand-made self-hosted').words).toBe(2);
  });

  it('handles empty input without dividing by zero', () => {
    expect(readingTime('')).toEqual({ words: 0, minutes: 0, wpm: 238 });
  });
});

describe('readingTime complexity model', () => {
  it('uses the measured baseline rate for average-length prose', () => {
    const { wpm } = readingTime(words(500));
    expect(wpm).toBeGreaterThan(215);
    expect(wpm).toBeLessThan(245);
  });

  it('slows down for longer words', () => {
    const plain = readingTime(words(500, 'cat')).wpm;
    const dense = readingTime(words(500, 'internationalisation')).wpm;
    expect(dense).toBeLessThan(plain);
  });

  it('never leaves the range observed in adult readers', () => {
    for (const w of ['a', 'to', 'incomprehensibilities', 'antidisestablishmentarianism']) {
      const { wpm } = readingTime(words(300, w));
      expect(wpm).toBeGreaterThanOrEqual(150);
      expect(wpm).toBeLessThanOrEqual(300);
    }
  });

  it('reproduces the paper’s two anchor points', () => {
    const at = (len: number) => readingTime(Array(400).fill('x'.repeat(len)).join(' ')).wpm;
    expect(at(5)).toBeGreaterThan(230);
    expect(at(5)).toBeLessThan(240);
    expect(at(4)).toBeGreaterThan(275);
  });

  it('charges time for code rather than discarding it', () => {
    const prose = 'word '.repeat(200);
    const withCode = prose + '\n\n```js\n' + 'const x = 1;\n'.repeat(60) + '```\n';
    expect(readingTime(withCode).minutes).toBeGreaterThan(readingTime(prose).minutes);
  });

  it('charges time for images', () => {
    const prose = 'word '.repeat(300);
    const withImages = prose + '\n\n' + '![alt](/a.png)\n'.repeat(8);
    expect(readingTime(withImages).minutes).toBeGreaterThanOrEqual(readingTime(prose).minutes);
  });

  it('rounds up so nothing reads as zero minutes', () => {
    expect(readingTime('a few words here').minutes).toBe(1);
  });

  it('two code blocks of identical line count but different nesting produce different minutes', () => {
    const flatLines = Array.from({ length: 8 }, (_, i) => `if (v${i}) { x(); }`);
    const flat = '```js\n' + flatLines.join('\n') + '\n```\n';

    const nestedLines = Array.from({ length: 8 }, (_, i) =>
      i < 7
        ? `${'  '.repeat(i)}if (v${i}) {`
        : `${'  '.repeat(i)}if (v${i}) { x(); }` + ' }'.repeat(7),
    );
    const nested = '```js\n' + nestedLines.join('\n') + '\n```\n';

    expect(readingTime(flat).words).toBe(0);
    expect(readingTime(nested).words).toBe(0);
    expect(readingTime(nested).minutes).toBeGreaterThan(readingTime(flat).minutes);
  });
});

describe('readingTime notation', () => {
  it('charges time for math instead of reading LaTeX as words', () => {
    const prose = words(300);
    const display = '\n\n$$\n\\log_{10} x = \\frac{\\log_2 x}{\\log_2 10}\n$$\n';
    const withMath = prose + display.repeat(10);
    expect(readingTime(withMath).words).toBe(300);
    expect(readingTime(withMath).minutes).toBeGreaterThan(readingTime(prose).minutes);
  });

  it('counts inline math symbols, not its markup', () => {
    const md = words(200) + ' $x = 10$';
    expect(readingTime(md).words).toBe(200);
  });

  it('counts inline code as words', () => {
    expect(readingTime('call `ilog2(x)` here').words).toBe(4);
  });

  it('does not read stray symbols as easy short words', () => {
    const prose = words(400);
    const littered = prose + ' ' + Array(200).fill('=').join(' ');
    expect(readingTime(littered).wpm).toBeLessThanOrEqual(readingTime(prose).wpm);
  });

  it('reads prose full of notation more slowly', () => {
    const plain = words(400);
    const technical = Array(400)
      .fill(0)
      .map((_, i) => (i % 4 === 0 ? '`ilog2`' : 'house'))
      .join(' ');
    expect(readingTime(technical).wpm).toBeLessThan(readingTime(plain).wpm);
  });

  it('treats an MDX component as a figure, not words', () => {
    const chart =
      "import Chart from '../c.astro';\n\n<Chart\n  title=\"t\"\n  spec={{ data: { values: [{ x: 1, y: 2 }] }, mark: 'line' }}\n/>\n";
    const prose = words(300);
    expect(readingTime(prose + '\n\n' + chart).words).toBe(300);
    const withFigures = prose + ('\n\n' + chart).repeat(8);
    expect(readingTime(withFigures).minutes).toBeGreaterThan(readingTime(prose).minutes);
  });

  it('leaves dollar signs inside code alone', () => {
    const md = words(100) + '\n\n```sh\necho $HOME $PATH\n```\n';
    expect(readingTime(md).words).toBe(100);
  });
});

describe('cognitiveComplexity', () => {
  it('scores flat code with no control flow as 0', () => {
    expect(cognitiveComplexity('const a = 1;\nconst b = 2;\nconsole.log(a, b);')).toBe(0);
  });

  it('scores a single if as 1', () => {
    expect(cognitiveComplexity('if (x) {\n  y();\n}')).toBe(1);
  });

  it('scores nesting higher than the same statements flat', () => {
    const nested = ['for (let i = 0; i < n; i++) {', '  if (x) {', '    y();', '  }', '}'].join(
      '\n',
    );
    const flat = ['if (x) {', '  y();', '}', 'for (let i = 0; i < n; i++) {', '  z();', '}'].join(
      '\n',
    );
    expect(cognitiveComplexity(nested)).toBeGreaterThan(cognitiveComplexity(flat));
  });

  it('counts each && and || as a point', () => {
    expect(cognitiveComplexity('if (a && b || c) {\n  y();\n}')).toBe(3);
  });

  it('scores an empty block as 0', () => {
    expect(cognitiveComplexity('')).toBe(0);
    expect(cognitiveComplexity('   \n  \n')).toBe(0);
  });

  it('gives tabs and spaces the same score for equivalent nesting', () => {
    const spaces = 'for (i) {\n  if (x) {\n    y();\n  }\n}';
    const tabs = 'for (i) {\n\tif (x) {\n\t\ty();\n\t}\n}';
    expect(cognitiveComplexity(tabs)).toBe(cognitiveComplexity(spaces));
  });

  const nestedFn = [
    'function foo(a) {',
    '  if (a) {',
    '    level2();',
    '    try {',
    '      if (nested) {',
    '        level4();',
    '      }',
    '    }',
    '  }',
    '}',
  ].join('\n');

  it('is unaffected by adding a JSDoc/block comment', () => {
    const withJsdoc = '/**\n * Does the thing.\n */\n' + nestedFn;
    expect(cognitiveComplexity(withJsdoc)).toBe(cognitiveComplexity(nestedFn));
  });

  it('is unaffected by adding a # line comment', () => {
    const plain = 'if (a) {\n  y();\n}';
    const withHashComment = '# TODO: handle if and for later\n' + plain;
    expect(cognitiveComplexity(withHashComment)).toBe(cognitiveComplexity(plain));
  });

  it('scores 0 when the only keywords are inside a string literal', () => {
    expect(cognitiveComplexity('const s = "if you build it";')).toBe(0);
  });

  it('scores 0 when the only keywords are inside a // comment', () => {
    expect(cognitiveComplexity('// if this fails, retry\ndoSomething();')).toBe(0);
  });

  it('is independent of the indent unit: 2 spaces, 4 spaces, and tabs score the same', () => {
    const twoSpace = 'for (i) {\n  if (x) {\n    y();\n  }\n}';
    const fourSpace = 'for (i) {\n    if (x) {\n        y();\n    }\n}';
    const tabs = 'for (i) {\n\tif (x) {\n\t\ty();\n\t}\n}';
    const score = cognitiveComplexity(twoSpace);
    expect(cognitiveComplexity(fourSpace)).toBe(score);
    expect(cognitiveComplexity(tabs)).toBe(score);
  });

  it('is unaffected by a stray under-indented continuation line', () => {
    const noStray = 'function foo(a) {\n  if (a) {\n    doThing(x, y);\n  }\n}';
    const withStray = 'function foo(a) {\n  if (a) {\n    doThing(x,\ny);\n  }\n}';
    expect(cognitiveComplexity(withStray)).toBe(cognitiveComplexity(noStray));
  });

  it('does not treat a CLI flag as a comment, and counts the && after it', () => {
    const shell = 'brotli --quality 11 && gzip -9\nif [ -f x ]; then y; fi';
    expect(cognitiveComplexity(shell)).toBe(2);
  });

  it('does not treat a decrement as a comment, and counts what follows it', () => {
    const code = 'while (n--) { if (a && b) x(); }';
    expect(cognitiveComplexity(code)).toBe(3);
  });

  it('still treats a line-leading # as a comment', () => {
    const code = '# comment with if and for\nreal();';
    expect(cognitiveComplexity(code)).toBe(0);
  });

  it('does not treat a mid-line # (CSS hex color) as a comment', () => {
    const code = 'border: 1px solid #fff; if (x) y();';
    expect(cognitiveComplexity(code)).toBe(1);
  });

  it('still treats a leading Python comment as a comment, keeping the real line', () => {
    const code = '# do the thing\nif x:';
    expect(cognitiveComplexity(code)).toBe(1);
  });
});
