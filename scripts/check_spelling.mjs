#!/usr/bin/env node
// Spell-checks the prose a reader sees, taken from the built HTML rather than
// from source, so post bodies, page copy, alt text and meta descriptions are
// all covered in one pass. Project vocabulary lives in cspell.json.
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { walk } from './lib/fswalk.mjs';

const ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  mdash: ' ',
  ndash: ' ',
  hellip: '...',
  rsquo: "'",
  lsquo: "'",
  ldquo: '"',
  rdquo: '"',
  middot: ' ',
  times: ' ',
};

/** Remove an element and everything inside it, by opening-tag pattern. */
export function dropSubtree(html, open, tag) {
  let out = '';
  let i = 0;
  for (;;) {
    open.lastIndex = i;
    const start = open.exec(html);
    if (!start) return out + html.slice(i);
    out += html.slice(i, start.index);

    let depth = 1;
    const scan = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'g');
    scan.lastIndex = start.index + start[0].length;
    let end = html.length;
    for (let m; (m = scan.exec(html));) {
      depth += m[1] ? -1 : 1;
      if (depth === 0) {
        end = scan.lastIndex;
        break;
      }
    }
    i = end;
  }
}

/** The reader-visible prose of one page. */
export function visibleText(html) {
  let text = html;
  for (const tag of ['script', 'style', 'pre', 'code']) {
    text = dropSubtree(text, new RegExp(`<${tag}\\b[^>]*>`, 'g'), tag);
  }
  text = dropSubtree(text, /<span class="katex[^"]*"[^>]*>/g, 'span');

  const described = [];
  for (const m of text.matchAll(/\b(?:alt|title)="([^"]*)"/g)) described.push(m[1]);
  for (const m of text.matchAll(/<meta name="description" content="([^"]*)"/g))
    described.push(m[1]);

  return [text.replace(/<[^>]+>/g, ' '), ...described]
    .join('\n')
    .replace(/&(#x?[0-9a-f]+|\w+);/gi, (whole, name) => {
      if (name[0] === '#') {
        const code = name[1] === 'x' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : ' ';
      }
      return ENTITIES[name.toLowerCase()] ?? ' ';
    })
    .replace(/[^\p{L}\p{N}\s'-]+/gu, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

async function main(distDir = 'dist') {
  const work = await mkdtemp(join(tmpdir(), 'spell-'));
  const origin = new Map();
  try {
    for await (const path of walk(distDir)) {
      if (!path.endsWith('.html')) continue;
      const text = visibleText(await readFile(path, 'utf8'));
      if (!text) continue;
      const page = `/${relative(distDir, path).split(sep).join('/')}`;
      const name = `${page.replace(/\/index\.html$/, '').replace(/[^\w]+/g, '_') || 'root'}.txt`;
      origin.set(name, page);
      await writeFile(join(work, name), `${text}\n`);
    }

    // cspell resolves globs against its own cwd.
    const run = spawnSync(
      'npx',
      [
        'cspell',
        'lint',
        '--no-progress',
        '--no-summary',
        '--no-color',
        '--config',
        resolve('cspell.json'),
        '*.txt',
      ],
      { encoding: 'utf8', cwd: work },
    );
    if (run.error) {
      console.error(`FAIL: could not run cspell: ${run.error.message}`);
      process.exit(1);
    }

    const found = new Map();
    for (const line of run.stdout.split('\n')) {
      const m = /^(\S+?):\d+:\d+\s+-\s+Unknown word \((.+?)\)/.exec(line.trim());
      if (!m) continue;
      const page = origin.get(m[1].split('/').pop()) ?? m[1];
      if (!found.has(m[2])) found.set(m[2], new Set());
      found.get(m[2]).add(page);
    }

    if (found.size) {
      console.error(`FAIL: ${found.size} unrecognized word(s) in page copy`);
      for (const [word, pages] of [...found].sort()) {
        console.error(`  ${word}  (${[...pages].sort().join(', ')})`);
      }
      console.error('  Fix the typo, or add the word to cspell.json if it is correct.');
      process.exit(1);
    }
    console.log(`ok: spelling clean across ${origin.size} page(s)`);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main(process.argv[2]);
}
