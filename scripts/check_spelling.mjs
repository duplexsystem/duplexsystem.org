#!/usr/bin/env node
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { GateError, REPO_ROOT, htmlPages, report, runMain } from './lib/gates.mjs';
import { dropSubtree } from './lib/html.mjs';

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
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[^\p{L}\p{N}\s'-]+/gu, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

export function unknownWords(run, origin) {
  const found = new Map();
  for (const line of run.stdout.split('\n')) {
    const m = /^(\S+?):\d+:\d+\s+-\s+Unknown word \((.+?)\)/.exec(line.trim());
    if (!m) continue;
    const page = origin.get(m[1].split('/').pop()) ?? m[1];
    if (!found.has(m[2])) found.set(m[2], new Set());
    found.get(m[2]).add(page);
  }
  if (run.status !== 0 && found.size === 0) {
    const why = run.stderr?.trim() || run.stdout.trim() || `exit ${run.status}`;
    throw new GateError(`cspell failed without reporting any word: ${why}`);
  }
  return found;
}

async function main(distDir = 'dist') {
  const work = await mkdtemp(join(tmpdir(), 'spell-'));
  const origin = new Map();
  try {
    for await (const { rel, html } of htmlPages(distDir)) {
      const text = visibleText(html);
      if (!text) continue;
      const page = `/${rel}`;
      const name = `${page.replace(/\/index\.html$/, '').replace(/[^\w]+/g, '_') || 'root'}.txt`;
      origin.set(name, page);
      await writeFile(join(work, name), `${text}\n`);
    }

    const run = spawnSync(
      process.execPath,
      [
        fileURLToPath(import.meta.resolve('cspell/bin')),
        'lint',
        '--no-progress',
        '--no-summary',
        '--no-color',
        '--config',
        join(REPO_ROOT, 'cspell.json'),
        '*.txt',
      ],
      { encoding: 'utf8', cwd: work },
    );
    if (run.error) throw new GateError(`could not run cspell: ${run.error.message}`);

    const found = unknownWords(run, origin);
    const lines = [...found]
      .sort()
      .map(([word, pages]) => `${word}  (${[...pages].sort().join(', ')})`);
    if (
      !report(
        `${found.size} unrecognized word(s) in page copy`,
        lines,
        `ok: spelling clean across ${origin.size} page(s)`,
      )
    ) {
      console.error('  Fix the typo, or add the word to cspell.json if it is correct.');
    }
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

await runMain(import.meta.url, main);
