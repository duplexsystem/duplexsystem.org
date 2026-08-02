#!/usr/bin/env node
import { readFile, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { walk } from './lib/fswalk.mjs';

const EXECUTABLE_TYPES = new Set(['', 'module', 'text/javascript', 'application/javascript']);

export function isExecutableScript(openTag) {
  const m = /\btype\s*=\s*["']([^"']*)["']/i.exec(openTag);
  const type = m ? m[1].toLowerCase() : '';
  return EXECUTABLE_TYPES.has(type);
}

export function executableScriptCount(html) {
  const opens = html.match(/<script\b[^>]*>/gi) ?? [];
  return opens.filter(isExecutableScript).length;
}

// A page may ship script only where its own HTML shows why: /search/ (pagefind),
// a code block (copy button), an embed (web component), a hero or placeholder
// (blurhash fade). Everything else ships zero JS.
// Astro's Shiki marks output `astro-code`; the site's own renderer marks `shiki`.
const CODE_BLOCK_EVIDENCE = /<pre\b[^>]*\bclass="[^"]*\b(?:astro-code|shiki)\b/;
const EMBED_EVIDENCE = /<[a-z][a-z0-9]*-[a-z0-9]+(?:-[a-z0-9]+)*[\s/>]/;
const HERO_EVIDENCE = /class="hero-wrap"/;
const PLACEHOLDER_EVIDENCE = /class="ph[ "]/;
const CIPHER_EVIDENCE = /id="addr"[^>]*data-cipher=/;

function isAllowed(relPath, html) {
  if (relPath === 'search/index.html') return true;
  if (CODE_BLOCK_EVIDENCE.test(html)) return true;
  if (CIPHER_EVIDENCE.test(html)) return true;
  if (/^blog\/[^/]+\/index\.html$/.test(relPath)) {
    return EMBED_EVIDENCE.test(html) || HERO_EVIDENCE.test(html) || PLACEHOLDER_EVIDENCE.test(html);
  }
  return false;
}

async function main(distDir = 'dist') {
  const failures = [];

  for await (const path of walk(distDir)) {
    if (!path.endsWith('.html')) continue;
    const html = await readFile(path, 'utf8');
    const count = executableScriptCount(html);
    if (count === 0) continue;

    const rel = relative(distDir, path).split(sep).join('/');
    if (!isAllowed(rel, html)) {
      failures.push(
        `${path}: ships ${count} executable <script> tag(s) with no code block, embed, or hero to justify it`,
      );
    }
  }

  if (failures.length) {
    console.error('FAIL: unexpected JavaScript shipped');
    for (const f of failures) console.error(`  ${f}`);
    process.exit(1);
  }
  console.log('ok: JavaScript ships only on /search/ and posts with a code block or an embed');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main(process.argv[2]);
}
