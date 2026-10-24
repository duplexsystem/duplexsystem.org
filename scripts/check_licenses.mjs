#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { posixRel, walk } from './lib/fswalk.mjs';
import { GateError, report, runMain } from './lib/gates.mjs';

const SCRIPT = /\.m?js$/;

export function declaredScriptHrefs(html) {
  const table = /<table id="jslicense-labels1"[^>]*>([\s\S]*?)<\/table>/.exec(html);
  if (!table) return null;
  return new Set(
    [...table[1].matchAll(/href="([^"]+)"/g)]
      .map((m) => m[1])
      .filter((href) => href.startsWith('/')),
  );
}

async function shippedScripts(distDir) {
  const hrefs = new Set();
  for await (const path of walk(distDir)) {
    if (SCRIPT.test(path)) hrefs.add(`/${posixRel(distDir, path)}`);
  }
  return hrefs;
}

export function unlistedAndStale(declared, shipped) {
  return [
    ...[...shipped].filter((href) => !declared.has(href)).map((h) => `${h}: shipped, not listed`),
    ...[...declared].filter((href) => !shipped.has(href)).map((h) => `${h}: listed, not shipped`),
  ].sort();
}

async function main(distDir = 'dist') {
  const labelsPath = join(distDir, 'licenses', 'index.html');
  const html = await readFile(labelsPath, 'utf8');

  const declared = declaredScriptHrefs(html);
  if (!declared) throw new GateError(`${labelsPath} has no <table id="jslicense-labels1">`);

  const problems = unlistedAndStale(declared, await shippedScripts(distDir));
  report(
    '/licenses/ Web Labels table and the shipped scripts disagree:',
    problems,
    `ok: /licenses/ Web Labels table lists exactly the ${declared.size} shipped scripts`,
  );
}

await runMain(import.meta.url, main);
