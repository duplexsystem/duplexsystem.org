import { describe, it, expect } from 'vitest';
import { rewriteUrls } from './localize_embed_media.mjs';

describe('rewriteUrls', () => {
  it('rewrites plain and &amp;-escaped URLs', () => {
    const map = new Map([['https://i.example/a.jpg?x=1&y=2', '/embeds/a.webp']]);
    expect(rewriteUrls('<img src="https://i.example/a.jpg?x=1&amp;y=2">', map)).toBe(
      '<img src="/embeds/a.webp">',
    );
  });

  it('does not let a URL clip a longer one it prefixes', () => {
    const map = new Map([
      ['https://i.example/a.jpg', '/embeds/short.webp'],
      ['https://i.example/a.jpg?w=2', '/embeds/long.webp'],
    ]);
    expect(
      rewriteUrls(
        '<img src="https://i.example/a.jpg?w=2"><img src="https://i.example/a.jpg">',
        map,
      ),
    ).toBe('<img src="/embeds/long.webp"><img src="/embeds/short.webp">');
  });
});
