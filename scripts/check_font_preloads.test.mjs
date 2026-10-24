import { describe, it, expect } from 'vitest';
import { preloadedFonts } from './check_font_preloads.mjs';

describe('preloadedFonts', () => {
  it('returns only font preloads, in order', () => {
    const html =
      '<link rel="preload" href="/a.woff2" as="font" type="font/woff2" crossorigin>' +
      '<link rel="preload" href="/x.css" as="style">' +
      '<link rel="stylesheet" href="/s.css">' +
      '<link rel="preload" href="/b.woff2" as="font" crossorigin>';
    expect(preloadedFonts(html)).toEqual(['/a.woff2', '/b.woff2']);
  });
});
