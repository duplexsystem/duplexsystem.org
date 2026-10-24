import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';

const here = (f: string) => new URL(f, import.meta.url);
const nginx = (f: string) => here(`../../nginx/${f}`);
const codesIn = (text: string, re: RegExp) => [...text.matchAll(re)].map((m) => m[1]).sort();

describe('nginx error pages', () => {
  const built = readdirSync(here('../data/errors/'))
    .map((f) => f.replace(/\.yaml$/, ''))
    .sort();

  it('site.conf maps exactly the codes that have a built page', () => {
    const site = readFileSync(nginx('site.conf'), 'utf8');
    expect(codesIn(site, /^error_page (\d+) \/errors\/\1\/index\.html;$/gm)).toEqual(built);
  });

  it('the portal snippet and the preview mirror map the same codes', () => {
    const snippet = readFileSync(nginx('error-portal.snippet.conf'), 'utf8');
    const preview = readFileSync(nginx('preview.conf'), 'utf8');
    expect(codesIn(snippet, /^error_page (\d+) \/_eportal\/\1;$/gm)).toEqual(built);
    expect(codesIn(preview, /^\s*error_page (\d+) \/_eportal\/\1;$/gm)).toEqual(built);
  });
});

describe('site.conf', () => {
  it('lets gzip_vary set Vary: Accept-Encoding instead of repeating it per location', () => {
    const site = readFileSync(nginx('site.conf'), 'utf8');
    expect(site).toMatch(/^gzip_vary\s+on;/m);
    expect(site).not.toMatch(/add_header Vary "Accept-Encoding"/);
  });
});
