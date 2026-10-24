#!/usr/bin/env node
import { attrsOf, htmlPages, openTags, report, runMain } from './lib/gates.mjs';

const EXECUTABLE_TYPES = new Set([
  '',
  'module',
  'application/ecmascript',
  'application/javascript',
  'application/x-ecmascript',
  'application/x-javascript',
  'text/ecmascript',
  'text/javascript',
  'text/javascript1.0',
  'text/javascript1.1',
  'text/javascript1.2',
  'text/javascript1.3',
  'text/javascript1.4',
  'text/javascript1.5',
  'text/jscript',
  'text/livescript',
  'text/x-ecmascript',
  'text/x-javascript',
]);

export function isExecutableScript(openTag) {
  const type = (attrsOf(openTag).get('type') ?? '').split(';')[0].trim().toLowerCase();
  return EXECUTABLE_TYPES.has(type);
}

export function executableScriptCount(html) {
  let count = 0;
  for (const { name, text } of openTags(html)) {
    if (name === 'script' && isExecutableScript(text)) count += 1;
  }
  return count;
}

const CODE_BLOCK_EVIDENCE = /<pre\b[^>]*\bclass="[^"]*\b(?:astro-code|shiki)\b/;
const EMBED_EVIDENCE = /<[a-z][a-z0-9]*-[a-z0-9]+(?:-[a-z0-9]+)*[\s/>]/;
const CIPHER_EVIDENCE = /id="addr"[^>]*data-cipher=/;

export function isAllowed(relPath, html) {
  if (relPath === 'search/index.html') return true;
  if (CODE_BLOCK_EVIDENCE.test(html)) return true;
  if (CIPHER_EVIDENCE.test(html)) return true;
  if (/^blog\/[^/]+\/index\.html$/.test(relPath)) {
    return EMBED_EVIDENCE.test(html);
  }
  return false;
}

async function main(distDir = 'dist') {
  const failures = [];

  for await (const { path, rel, html } of htmlPages(distDir)) {
    const count = executableScriptCount(html);
    if (count > 0 && !isAllowed(rel, html)) {
      failures.push(
        `${path}: ships ${count} executable <script> tag(s) with no code block or embed to justify it`,
      );
    }
  }

  report(
    'unexpected JavaScript shipped',
    failures,
    'ok: JavaScript ships only on /search/ and posts with a code block or an embed',
  );
}

await runMain(import.meta.url, main);
