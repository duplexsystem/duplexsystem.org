import { describe, it, expect } from 'vitest';
import { isAllowed, isExecutableScript, executableScriptCount } from './check_js.mjs';

describe('isExecutableScript', () => {
  it('treats a plain <script> as executable', () => {
    expect(isExecutableScript('<script>')).toBe(true);
  });

  it('treats module and text/javascript as executable', () => {
    expect(isExecutableScript('<script type="module">')).toBe(true);
    expect(isExecutableScript('<script type="text/javascript">')).toBe(true);
    expect(isExecutableScript('<script type="application/javascript">')).toBe(true);
  });

  it('does not treat application/ld+json as executable', () => {
    expect(isExecutableScript('<script type="application/ld+json">')).toBe(false);
  });

  it('does not treat an unrecognized type as executable', () => {
    expect(isExecutableScript('<script type="text/plain">')).toBe(false);
  });
});

describe('executableScriptCount', () => {
  it('counts inline scripts but not JSON-LD', () => {
    const html = `
      <script type="application/ld+json">{"a":1}</script>
      <script is:inline>console.log(1);</script>
    `;
    expect(executableScriptCount(html)).toBe(1);
  });

  it('is zero when the only script tag is JSON-LD', () => {
    const html = '<script type="application/ld+json">{"a":1}</script>';
    expect(executableScriptCount(html)).toBe(0);
  });

  it('is zero for a page with no script tags at all', () => {
    expect(executableScriptCount('<p>hi</p>')).toBe(0);
  });
});

describe('attribute lookalikes', () => {
  it('does not take data-type for the script type', () => {
    expect(isExecutableScript('<script data-type="application/ld+json">')).toBe(true);
    expect(executableScriptCount('<script data-type="json">a()</script>')).toBe(1);
  });

  it('reads a type after a ">" in an earlier attribute', () => {
    expect(
      executableScriptCount('<script data-x="a>b" type="application/ld+json">{}</script>'),
    ).toBe(0);
  });
});

describe('legacy JavaScript types', () => {
  it('counts every type a browser runs as JavaScript, with parameters and case', () => {
    for (const t of [
      'text/ecmascript',
      'application/x-javascript',
      'TEXT/JavaScript; charset=utf-8',
      ' module ',
      'text/javascript1.5',
    ]) {
      expect(isExecutableScript(`<script type="${t}">`), t).toBe(true);
    }
    for (const t of ['importmap', 'speculationrules', 'application/json', 'text/template']) {
      expect(isExecutableScript(`<script type="${t}">`), t).toBe(false);
    }
  });
});

describe('isAllowed', () => {
  const plain = '<p>hello</p><img src="/a.webp" class="placeholder">';
  it('gives an image-only post no reason to ship script', () => {
    expect(isAllowed('blog/p/index.html', plain)).toBe(false);
    expect(isAllowed('index.html', plain)).toBe(false);
  });
  it('allows /search/, a code block (Shiki, runnable arm64 included), an embed and the cipher', () => {
    expect(isAllowed('search/index.html', plain)).toBe(true);
    const pre = (extra) => `<pre class="astro-code violet-dark ${extra}" data-language="arm64">`;
    expect(isAllowed('blog/p/index.html', pre(''))).toBe(true);
    expect(isAllowed('blog/p/index.html', pre('is-runnable has-line-numbers'))).toBe(true);
    expect(isAllowed('blog/p/index.html', '<lite-youtube></lite-youtube>')).toBe(true);
    expect(isAllowed('index.html', '<lite-youtube></lite-youtube>')).toBe(false);
    expect(isAllowed('contact/index.html', '<a id="addr" data-cipher="x">')).toBe(true);
  });
});
