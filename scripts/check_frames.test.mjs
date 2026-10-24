import { describe, it, expect } from 'vitest';
import {
  allTablesFramed,
  heroNotBlurred,
  noUnframedImages,
  noScriptedCharts,
  everyBarHasBody,
  noUnframedEmbeds,
} from './check_frames.mjs';
import { stripEmbedFigures } from './lib/gates.mjs';

describe('stripEmbedFigures', () => {
  it('removes an entire frame--embed figure, bar, body, table and all', () => {
    const html =
      '<figure class="frame frame--embed"><div class="frame__bar">Gist</div><div class="frame__body"><astro-embed-gist><template shadowrootmode="open"><table class="highlight"><tr><td>code</td></tr></table></template></astro-embed-gist></div></figure>';
    const stripped = stripEmbedFigures(html);
    expect(stripped).not.toContain('<table');
    expect(stripped).not.toContain('astro-embed-gist');
    expect(stripped).not.toContain('frame__bar');
  });

  it('handles a template nested inside the shadow-root template without closing early on the inner tag', () => {
    const html =
      '<figure class="frame frame--embed"><div class="frame__body"><astro-embed-gist><template shadowrootmode="open">' +
      '<template class="js-file-alert-template">alert markup</template>' +
      '<table class="highlight"><tr><td>code</td></tr></table>' +
      '</template></astro-embed-gist></div></figure>';
    const stripped = stripEmbedFigures(html);
    expect(stripped).not.toContain('<table');
    expect(stripped).not.toContain('alert markup');
  });

  it('handles light-DOM embed content (Bluesky/Tweet/LinkPreview render no <template> at all)', () => {
    const html =
      '<figure class="frame frame--embed"><div class="frame__bar">BlueskyPost</div><div class="frame__body">' +
      '<div class="bluesky-post-container"><p class="post-text">hello <img src="a.jpg" alt="a"></p></div>' +
      '</div></figure>';
    const stripped = stripEmbedFigures(html);
    expect(stripped).not.toContain('<img');
    expect(stripped).not.toContain('post-text');
  });

  it('handles a nested <figure> inside third-party embed content', () => {
    const html =
      '<figure class="frame frame--embed"><div class="frame__body">' +
      '<div class="bluesky-post-container"><figure><img src="nested.jpg" alt="n"><figcaption>photo</figcaption></figure></div>' +
      '</div></figure>';
    const stripped = stripEmbedFigures(html);
    expect(stripped).not.toContain('nested.jpg');
  });

  it('leaves non-embed figures (table, image, chart) untouched', () => {
    const html =
      '<figure class="frame"><div class="frame__bar">table</div><div class="frame__body"><table></table></div></figure>' +
      '<figure class="frame chart"><div class="frame__body"><svg></svg></div></figure>';
    expect(stripEmbedFigures(html)).toBe(html);
  });

  it('leaves ordinary content with no figures untouched', () => {
    const html = '<p>Some prose.</p>';
    expect(stripEmbedFigures(html)).toBe(html);
  });
});

describe('allTablesFramed', () => {
  it('passes a table wrapped in .frame__scroll', () => {
    const html =
      '<figure class="frame"><div class="frame__bar">table</div><div class="frame__body"><div class="frame__scroll" tabindex="0" role="region"><table><tr><td>1</td></tr></table></div></div></figure>';
    expect(allTablesFramed(html)).toBe(true);
  });

  it('fails a table with no .frame__scroll wrapper', () => {
    const html = '<p>intro</p><table><tr><td>1</td></tr></table>';
    expect(allTablesFramed(html)).toBe(false);
  });

  it('tolerates the deliberately unframed jslicense-labels1 table appearing on a page (the caller scopes files, not this function)', () => {
    const html = '<table id="jslicense-labels1"><tr><td>a.js</td></tr></table>';
    expect(allTablesFramed(html)).toBe(false);
  });

  it("ignores a table rendered by an embed (GitHub Gist's own file viewer), which this task never framed", () => {
    const html =
      '<figure class="frame frame--embed"><div class="frame__bar">Gist</div><div class="frame__body"><astro-embed-gist><table class="highlight"><tr><td>code</td></tr></table></astro-embed-gist></div></figure>';
    expect(allTablesFramed(html)).toBe(true);
  });
});

describe('noUnframedImages', () => {
  it('passes when a lone image is wrapped in a figure', () => {
    const html =
      '<figure class="frame"><div class="frame__bar">image</div><div class="frame__body"><img src="a.webp" alt="a" loading="lazy" decoding="async"></div></figure>';
    expect(noUnframedImages(html)).toBe(true);
  });

  it('fails a <p><img></p> that escaped framing', () => {
    const html = '<p><img src="a.webp" alt="oops"></p>';
    expect(noUnframedImages(html)).toBe(false);
  });

  it('tolerates an attribute on the <p>: Astro stamps scoped-style hashes on owned elements', () => {
    const html = '<p data-astro-cid-abc123><img src="a.webp" alt="oops"></p>';
    expect(noUnframedImages(html)).toBe(false);
  });

  it("ignores an <img> that is not a paragraph's only child", () => {
    const html = '<p>Some prose with an <img src="a.webp" alt="inline"> image inline.</p>';
    expect(noUnframedImages(html)).toBe(true);
  });

  it('ignores a <p><img></p> rendered inside a light-DOM embed (a linked Bluesky post with an inline image)', () => {
    const html =
      '<figure class="frame frame--embed"><div class="frame__bar">BlueskyPost</div><div class="frame__body"><div class="bluesky-post-container"><p><img src="remote.jpg" alt="remote"></p></div></div></figure>';
    expect(noUnframedImages(html)).toBe(true);
  });
});

describe('noScriptedCharts', () => {
  it('passes a chart figure whose svg has no script', () => {
    const html =
      '<figure class="frame chart"><div class="frame__bar">chart</div><div class="frame__body"><svg role="img"><rect fill="#b48cff"/></svg></div></figure>';
    expect(noScriptedCharts(html)).toBe(true);
  });

  it('fails a chart figure whose svg carries a <script>', () => {
    const html =
      '<figure class="frame chart"><div class="frame__body"><svg><script>alert(1)</script></svg></div></figure>';
    expect(noScriptedCharts(html)).toBe(false);
  });

  it('ignores non-chart figures entirely, even if they somehow contained a script tag', () => {
    const html =
      '<figure class="frame frame--embed"><div class="frame__body"><script>alert(1)</script></div></figure>';
    expect(noScriptedCharts(html)).toBe(true);
  });

  it('still finds the chart figure if Chart.astro gains a <style> block and Astro stamps a data-astro-cid-* attribute or reorders the class list', () => {
    const scripted =
      '<figure data-astro-cid-x class="chart frame"><div class="frame__body"><svg><script>alert(1)</script></svg></div></figure>';
    expect(noScriptedCharts(scripted)).toBe(false);
  });
});

describe('everyBarHasBody', () => {
  it('passes when every .frame__bar is immediately followed by a .frame__body', () => {
    const html =
      '<figure class="frame"><div class="frame__bar">x</div><div class="frame__body">y</div></figure>'.repeat(
        2,
      );
    expect(everyBarHasBody(html)).toBe(true);
  });

  it('fails a .frame__bar with no sibling .frame__body', () => {
    const html =
      '<figure class="frame"><div class="frame__bar">x</div><p>oops, no body div here</p></figure>';
    expect(everyBarHasBody(html)).toBe(false);
  });

  it('fails when only one of two bars is paired correctly', () => {
    const good = '<div class="frame__bar">x</div><div class="frame__body">y</div>';
    const bad = '<div class="frame__bar">z</div><p>oops</p>';
    expect(everyBarHasBody(good + bad)).toBe(false);
  });

  it('fails a page that has a .frame figure but zero .frame__bar at all, rather than passing vacuously', () => {
    const html =
      '<figure class="frame"><div class="frame__body">just a body, no bar anywhere</div></figure>';
    expect(everyBarHasBody(html)).toBe(false);
  });

  it('passes a table without a title, whose frame has no bar', () => {
    const html =
      '<figure class="frame"><div class="frame__body"><div class="frame__scroll" tabindex="0" role="region"><table></table></div></div></figure>';
    expect(everyBarHasBody(html)).toBe(true);
  });

  it('still pairs correctly when Astro stamps a data-astro-cid-* attribute or reorders the class list', () => {
    const html =
      '<div data-astro-cid-x class="frame__bar">x</div><div class="frame__body" data-astro-cid-x>y</div>';
    expect(everyBarHasBody(html)).toBe(true);
  });
});

describe('noUnframedEmbeds', () => {
  it('passes when every custom-element embed host sits inside a frame--embed figure', () => {
    const html =
      '<figure class="frame frame--embed"><div class="frame__bar">YouTube</div><div class="frame__body"><lite-youtube videoid="x"></lite-youtube></div></figure>';
    expect(noUnframedEmbeds(html)).toBe(true);
  });

  it('fails when an embed custom element sits directly in the body with no frame--embed figure at all (the embed branch deleted from rehype/frame.mjs)', () => {
    const html = '<p>intro</p><lite-youtube videoid="x"></lite-youtube>';
    expect(noUnframedEmbeds(html)).toBe(false);
  });

  it('fails for an astro-embed-* host too, not just lite-*', () => {
    const html = '<astro-embed-gist></astro-embed-gist>';
    expect(noUnframedEmbeds(html)).toBe(false);
  });

  it('passes a page with no embeds at all', () => {
    const html =
      '<figure class="frame"><div class="frame__bar">table</div><div class="frame__body"><table></table></div></figure>';
    expect(noUnframedEmbeds(html)).toBe(true);
  });

  it('is the check that actually catches what everyBarHasBody cannot: deleting an embed removes its bar and body together, and the equality check alone cannot tell', () => {
    const html =
      '<figure class="frame"><div class="frame__bar">table</div><div class="frame__body"><table></table></div></figure><lite-youtube videoid="x"></lite-youtube>';
    expect(everyBarHasBody(html)).toBe(true);
    expect(noUnframedEmbeds(html)).toBe(false);
  });
});

describe('heroNotBlurred', () => {
  it('fails when the placeholder style sits on .hero-wrap, blurring the real image', () => {
    const html =
      '<div class="hero-wrap" style="background-image:linear-gradient(red,blue);filter:blur(24px);transform:scale(1.2)"><img class="post__hero" src="x.webp"></div>';
    expect(heroNotBlurred(html)).toBe(false);
  });

  it('passes when the placeholder is a sibling layer rather than an ancestor', () => {
    const html =
      '<div class="hero-wrap"><div class="hero-blur" style="background-image:linear-gradient(red,blue);filter:blur(24px)" aria-hidden="true"></div><img class="post__hero" src="x.webp"></div>';
    expect(heroNotBlurred(html)).toBe(true);
  });

  it('still catches the bug when Astro stamps a scoped-style attribute before the style', () => {
    const html =
      '<div class="hero-wrap" data-astro-cid-ssdmjifj style="filter:blur(24px)"><img class="post__hero"></div>';
    expect(heroNotBlurred(html)).toBe(false);
  });

  it('passes a page with no hero at all', () => {
    expect(heroNotBlurred('<p>no hero here</p>')).toBe(true);
  });
});
