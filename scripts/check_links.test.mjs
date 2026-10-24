import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { anchorsIn, cssUrls, extractRefs, findBroken, ownOriginPaths } from './check_links.mjs';

describe('extractRefs', () => {
  it('reads href, src, poster and every srcset candidate in any quoting', () => {
    const html = `<a href="/a/">x</a><img src='/i.webp' srcset="/s1.webp 1x, /s2.webp 2x">
      <video poster=/p.png></video>`;
    expect(extractRefs(html)).toEqual(['/a/', '/i.webp', '/s1.webp', '/s2.webp', '/p.png']);
  });

  it('ignores markup shown as text in a code block', () => {
    expect(extractRefs('<code>&lt;img src="/nope.png"&gt;</code>')).toEqual([]);
  });
});

describe('anchorsIn', () => {
  it('collects ids and a[name]', () => {
    expect([...anchorsIn('<h2 id="intro">x</h2><a name="old"></a>')]).toEqual(['intro', 'old']);
  });
});

describe('findBroken', () => {
  let dist;
  afterEach(async () => dist && rm(dist, { recursive: true, force: true }));

  async function site(files) {
    dist = await mkdtemp(join(tmpdir(), 'check-links-'));
    for (const [path, body] of Object.entries(files)) {
      await mkdir(join(dist, path, '..'), { recursive: true });
      await writeFile(join(dist, path), body);
    }
    return dist;
  }

  it('passes a site whose links, images and fragments all resolve', async () => {
    const dir = await site({
      'index.html': '<a href="/post/#sec">p</a><img src="/a%20b.webp"><a href="#top" id="top"></a>',
      'post/index.html': '<h2 id="sec">s</h2>',
      'a b.webp': '',
    });
    expect(await findBroken(dir)).toEqual([]);
  });

  it('flags a missing image, a missing fragment and a directory without index.html', async () => {
    const dir = await site({
      'index.html': '<img src="/gone.webp"><a href="/post/#nope">p</a><a href="/empty">e</a>',
      'post/index.html': '<h2 id="sec">s</h2>',
      'empty/readme.txt': '',
    });
    const broken = await findBroken(dir);
    expect(broken).toHaveLength(3);
    expect(broken.join('\n')).toMatch(/gone\.webp/);
    expect(broken.join('\n')).toMatch(/no element with id "nope"/);
    expect(broken.join('\n')).toMatch(/\/empty$/m);
  });
});

describe('tags whose attribute values hold ">"', () => {
  it('still reads the attributes after a ">" inside alt text', () => {
    expect(extractRefs('<img alt="a -> b" src="/gone.webp">')).toEqual(['/gone.webp']);
  });

  it('finds an id after a ">" inside an earlier attribute', () => {
    expect([...anchorsIn('<h2 title="x > y" id="sec">s</h2>')]).toEqual(['sec']);
  });
});

describe('findBroken on a tree with no pages', () => {
  it('refuses to pass: nothing was checked', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'check-links-'));
    try {
      await expect(findBroken(dir)).rejects.toThrow(/no HTML pages/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('CSS url() and style attributes', () => {
  it('reads every quoting of url() and leaves data: for the caller to skip', () => {
    expect([
      ...cssUrls(`a{b:url(/x.svg)}c{d:url( "/y.woff2" )}e{f:url('/z.png')}g{h:url(data:a;b)}`),
    ]).toEqual(['/x.svg', '/y.woff2', '/z.png', 'data:a;b']);
  });

  it('finds urls in style="" and <style> as extractRefs', () => {
    const html = `<div style="background:url('/a.webp')"></div><style>i{src:url(/b.woff2)}</style>`;
    expect(extractRefs(html)).toEqual(['/a.webp', '/b.woff2']);
  });
});

describe('findBroken beyond markup', () => {
  let dist;
  afterEach(async () => dist && rm(dist, { recursive: true, force: true }));

  async function site(files) {
    dist = await mkdtemp(join(tmpdir(), 'check-links-'));
    for (const [path, body] of Object.entries(files)) {
      await mkdir(join(dist, path, '..'), { recursive: true });
      await writeFile(join(dist, path), body);
    }
    return dist;
  }

  const home = '<link rel="canonical" href="https://example.org/"><a href="#top">up</a>';

  it('accepts #top without an element, as browsers do', async () => {
    expect(await findBroken(await site({ 'index.html': home }))).toEqual([]);
  });

  it('flags a url() in a stylesheet that nothing backs', async () => {
    const dir = await site({
      'index.html': home,
      '_astro/s.css': '@font-face{src:url(/_astro/gone.woff2)}i{b:url(data:image/png;base64,AA)}',
    });
    const broken = await findBroken(dir);
    expect(broken).toHaveLength(1);
    expect(broken[0]).toMatch(/s\.css -> \/_astro\/gone\.woff2/);
  });

  it('flags a feed entry, a sitemap url and a manifest icon that nothing backs', async () => {
    const dir = await site({
      'index.html': home,
      'rss.xml': '<link>https://example.org/blog/gone/</link><a href="https://example.org/">ok</a>',
      'feed.json': '{"url":"https://example.org/gone.webp"}',
      'manifest.webmanifest': '{"icons":[{"src":"/icon-gone.png"}]}',
    });
    const broken = (await findBroken(dir)).join('\n');
    expect(broken).toMatch(/rss\.xml -> \/blog\/gone\//);
    expect(broken).toMatch(/feed\.json -> \/gone\.webp/);
    expect(broken).toMatch(/manifest\.webmanifest -> \/icon-gone\.png/);
    expect(broken).not.toMatch(/rss\.xml -> \/ /);
  });

  it('checks an absolute link to the site as it would a root-relative one', async () => {
    const dir = await site({
      'index.html': `${home}<a href="https://example.org/gone/">x</a><a href="https://example.org/a/#nope">y</a><a href="https://other.org/gone/">z</a>`,
      'a/index.html': '<p id="yes">a</p>',
    });
    const broken = (await findBroken(dir)).join('\n');
    expect(broken).toMatch(/-> https:\/\/example\.org\/gone\//);
    expect(broken).toMatch(/example\.org\/a\/#nope/);
    expect(broken).not.toMatch(/other\.org/);
  });

  it('ownOriginPaths stops at entity, quote and escape boundaries', () => {
    expect(
      ownOriginPaths(
        'x https://example.org/a/&quot;&gt; "https://example.org/b.png\\" https://other.org/c',
        'https://example.org',
      ),
    ).toEqual(['/a/', '/b.png']);
  });
});
