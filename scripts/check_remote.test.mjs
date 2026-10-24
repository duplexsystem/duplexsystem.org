import { describe, it, expect } from 'vitest';
import { cssLoads, foreignHost, remoteLoads } from './check_remote.mjs';

describe('foreignHost', () => {
  it('is null for own-origin, relative and data URLs', () => {
    for (const u of [
      '/a.png',
      'a.png',
      'https://duplexsystem.org/a',
      'data:image/png;base64,AA',
      '#x',
    ])
      expect(foreignHost(u)).toBeNull();
  });
  it('names the host of absolute and protocol-relative URLs, case-insensitively', () => {
    expect(foreignHost('https://Fonts.Example.com/x')).toBe('fonts.example.com');
    expect(foreignHost('//cdn.x.net/a.js')).toBe('cdn.x.net');
    expect(foreignHost('https://duplexsystem.org.evil.test/a')).toBe('duplexsystem.org.evil.test');
  });
});

describe('remoteLoads', () => {
  it('ignores plain links, og/twitter meta and escaped markup in code', () => {
    const html =
      '<a href="https://x.test/">x</a><meta property="og:image" content="https://x.test/a.png">' +
      '<link rel="canonical" href="https://x.test/"><link rel="alternate" href="https://x.test/f.xml">' +
      '<pre>&lt;img src="https://x.test/a.png"&gt;</pre><!-- <img src="https://x.test/b.png"> -->';
    expect(remoteLoads(html)).toEqual([]);
  });
  it('flags every loading context', () => {
    const cases = [
      '<img src="https://x.test/a.png">',
      "<img src='//x.test/a.png'>",
      '<img srcset="/a.png 1x, https://x.test/b.png 2x">',
      '<video poster="https://x.test/p.jpg"></video>',
      '<iframe src="https://x.test/"></iframe>',
      '<script src="https://x.test/a.js"></script>',
      '<link rel="stylesheet" href="https://x.test/a.css">',
      '<link rel="preload stylesheet" href="https://x.test/a.css">',
      '<link href="https://x.test/a.ico" rel="icon">',
      '<link rel="modulepreload" href="https://x.test/a.js">',
      '<link rel="preconnect" href="https://x.test">',
      '<div style="background: url(https://x.test/a.png)"></div>',
      '<style>@import "https://x.test/a.css";</style>',
      '<style>a{background:url( "//x.test/a.png" )}</style>',
      '<svg><image href="https://x.test/a.png"/></svg>',
    ];
    for (const html of cases) expect(remoteLoads(html), html).toHaveLength(1);
  });
  it('passes own-origin loads', () => {
    expect(
      remoteLoads(
        '<img src="https://duplexsystem.org/a.png"><link rel="stylesheet" href="/a.css">',
      ),
    ).toEqual([]);
  });
});

describe('cssLoads', () => {
  it('reads url() and all @import forms', () => {
    const css =
      '@import url(https://a.test/x.css);@import "//b.test/y.css";@import \'z.css\';a{b:url(c.png)}';
    expect(cssLoads(css).sort()).toEqual([
      '//b.test/y.css',
      'c.png',
      'https://a.test/x.css',
      'z.css',
    ]);
  });
});
