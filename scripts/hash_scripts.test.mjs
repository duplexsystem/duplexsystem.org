import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import hashScripts, { rewriteScriptRefs } from './hash_scripts.mjs';

describe('rewriteScriptRefs', () => {
  it('swaps whole script URLs only', () => {
    const map = new Map([['/js/search.js', '/js/search.0123abcd.js']]);
    expect(rewriteScriptRefs('<script src="/js/search.js" defer>', map)).toBe(
      '<script src="/js/search.0123abcd.js" defer>',
    );
    expect(rewriteScriptRefs('<a href="/js/search.js">', map)).toBe(
      '<a href="/js/search.0123abcd.js">',
    );
    expect(rewriteScriptRefs('"/js/search.json"', map)).toBe('"/js/search.json"');
  });
});

describe('hashScripts', () => {
  it('names each script by its bytes and rewrites the pages that load it, once', async () => {
    const dist = await mkdtemp(join(tmpdir(), 'hash-scripts-'));
    try {
      await mkdir(join(dist, 'js'));
      await writeFile(join(dist, 'js', 'search.js'), 'console.log(1);');
      await writeFile(join(dist, 'index.html'), '<script src="/js/search.js" defer></script>');
      await hashScripts(dist);
      const [name] = await readdir(join(dist, 'js'));
      expect(name).toMatch(/^search\.[0-9a-f]{8}\.js$/);
      expect(await readFile(join(dist, 'index.html'), 'utf8')).toBe(
        `<script src="/js/${name}" defer></script>`,
      );
      await hashScripts(dist);
      expect(await readdir(join(dist, 'js'))).toEqual([name]);
    } finally {
      await rm(dist, { recursive: true, force: true });
    }
  });
});
