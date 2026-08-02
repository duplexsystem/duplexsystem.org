#!/usr/bin/env node
import { readFile, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { walk } from './lib/fswalk.mjs';

export function declaredScriptHrefs(html) {
  const table = /<table id="jslicense-labels1"[^>]*>([\s\S]*?)<\/table>/.exec(html);
  if (!table) return null;
  return new Set(
    [...table[1].matchAll(/href="([^"]+)"/g)]
      .map((m) => m[1])
      .filter((href) => href.startsWith('/')),
  );
}

async function main(distDir = 'dist') {
  const labelsPath = join(distDir, 'licenses', 'index.html');
  const html = await readFile(labelsPath, 'utf8');

  const declared = declaredScriptHrefs(html);
  if (!declared) {
    console.error(`FAIL: ${labelsPath} has no <table id="jslicense-labels1">`);
    process.exit(1);
  }

  const missing = [];
  for await (const path of walk(distDir)) {
    if (!path.endsWith('.js')) continue;
    const href = `/${relative(distDir, path).split(sep).join('/')}`;
    if (!declared.has(href)) missing.push(href);
  }

  if (missing.length) {
    console.error('FAIL: scripts shipped in dist but missing from /licenses/ Web Labels table:');
    for (const m of missing) console.error(`  ${m}`);
    process.exit(1);
  }
  console.log(
    `ok: /licenses/ Web Labels table covers every shipped script (${declared.size} declared hrefs)`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main(process.argv[2]);
}
