import { describe, it, expect } from 'vitest';
import { declaredScriptHrefs } from './check_licenses.mjs';

describe('declaredScriptHrefs', () => {
  it('returns null when the page has no jslicense-labels1 table', () => {
    expect(declaredScriptHrefs('<p>no table here</p>')).toBeNull();
  });

  it('collects site-relative hrefs from inside the table', () => {
    const html = `
      <table id="jslicense-labels1">
        <tr><td><a href="/pagefind/pagefind.js">pagefind.js</a></td>
        <td><a href="https://directory.fsf.org/wiki/License:Expat">Expat</a></td>
        <td><a href="https://example.com/src.tar.gz">source</a></td></tr>
      </table>`;
    expect(declaredScriptHrefs(html)).toEqual(new Set(['/pagefind/pagefind.js']));
  });

  it('ignores external (https:) hrefs, only a site-relative path can match a dist/ file', () => {
    const html = `
      <table id="jslicense-labels1">
        <tr><td>lite-youtube</td>
        <td><a href="https://directory.fsf.org/wiki/License:Expat">Expat</a></td>
        <td><a href="https://github.com/example/repo">source</a></td></tr>
      </table>`;
    expect(declaredScriptHrefs(html)).toEqual(new Set());
  });

  it('tolerates extra attributes on the <table> tag itself', () => {
    // Astro stamps a data-astro-cid-* attribute on every element belonging
    // to a component that has a scoped <style> block.
    const html = `
      <table id="jslicense-labels1" data-astro-cid-abc123>
        <tr><td><a href="/a.js">a.js</a></td><td></td><td></td></tr>
      </table>`;
    expect(declaredScriptHrefs(html)).toEqual(new Set(['/a.js']));
  });

  it('ignores hrefs outside the labels table', () => {
    const html = `
      <a href="/outside.js">outside</a>
      <table id="jslicense-labels1"><tr><td><a href="/inside.js">inside</a></td></tr></table>`;
    expect(declaredScriptHrefs(html)).toEqual(new Set(['/inside.js']));
  });
});
