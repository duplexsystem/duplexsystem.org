import { describe, it, expect } from 'vitest';
import { unknownWords, visibleText } from './check_spelling.mjs';

describe('visibleText', () => {
  it('keeps body prose', () => {
    expect(visibleText('<p>hello there</p>')).toBe('hello there');
  });

  it('drops script and style bodies, which are not prose', () => {
    const html = '<style>.a{color:red}</style><p>kept</p><script>var x = "dropped";</script>';
    expect(visibleText(html)).toBe('kept');
  });

  it('drops code and pre, so identifiers are never spell-checked', () => {
    expect(visibleText('<p>see <code>getBoundingClientRect</code> for this</p>')).toBe(
      'see for this',
    );
  });

  it('drops rendered math, whose spans nest several deep', () => {
    const html =
      '<p>before <span class="katex"><span class="katex-html">' +
      '<span class="mord">x</span></span></span> after</p>';
    expect(visibleText(html)).toBe('before after');
  });

  it('collects alt text, which a reader hears but never sees', () => {
    expect(visibleText('<img src="/a.png" alt="a violet button">')).toContain('a violet button');
  });

  it('collects the meta description, which shows up in search results', () => {
    const html = '<meta name="description" content="making slow things fast"><p>body</p>';
    expect(visibleText(html)).toContain('making slow things fast');
  });

  it('decodes entities so an escaped word is still checked', () => {
    expect(visibleText('<p>caf&#233; &amp; bar</p>')).toBe('café bar');
  });

  it('keeps a typographic apostrophe attached, or every contraction splits', () => {
    expect(visibleText('<p>I didn\u2019t know</p>')).toBe("I didn't know");
  });

  it('leaves apostrophes and hyphens attached to their words', () => {
    expect(visibleText("<p>it's a well-known non-binary flag</p>")).toBe(
      "it's a well-known non-binary flag",
    );
  });

  it('survives an unclosed element rather than swallowing the rest of the page', () => {
    expect(visibleText('<p>before <code>unclosed</p><p>after</p>')).toBe('before');
  });
});

describe('unknownWords', () => {
  const origin = new Map([['a.txt', '/a/']]);

  it('maps cspell output back to pages', () => {
    const run = { status: 1, stdout: 'a.txt:1:3 - Unknown word (teh)\n', stderr: '' };
    expect(unknownWords(run, origin)).toEqual(new Map([['teh', new Set(['/a/'])]]));
  });

  it('throws when cspell failed without naming a word, rather than passing', () => {
    expect(() => unknownWords({ status: 1, stdout: '', stderr: 'bad config' }, origin)).toThrow(
      /bad config/,
    );
  });

  it('passes a clean run', () => {
    expect(unknownWords({ status: 0, stdout: '', stderr: '' }, origin).size).toBe(0);
  });
});
