import { describe, it, expect } from 'vitest';
import { isExecutableScript, executableScriptCount } from './check_js.mjs';

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
