#!/usr/bin/env node
import { readFile, readdir, access } from 'node:fs/promises';
import { join } from 'node:path';
import { walk } from './lib/fswalk.mjs';

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

const IGNORE = /^(https?:|mailto:|#|data:)/;

/**
 * Paths nginx serves that no file in dist/ backs. `/.well-known/button` is
 * mapped onto the real 88x31 rather than given a second copy of the bytes, so
 * a filesystem check can never find it.
 *
 * Each entry is verified against the nginx config instead of being trusted as
 * a bare allowlist: an exemption whose server-side route was renamed or
 * deleted would otherwise sit here forever, silently excusing a link that is
 * genuinely broken in production.
 */
const SERVER_ROUTED = ['/.well-known/button'];
const NGINX_DIR = 'nginx';

async function serverRoutes() {
  let conf = '';
  try {
    for (const name of await readdir(NGINX_DIR)) {
      if (name.endsWith('.conf')) conf += await readFile(join(NGINX_DIR, name), 'utf8');
    }
  } catch {
    throw new Error(
      `${NGINX_DIR}/ is unreadable, so ${SERVER_ROUTED.length} exempt path(s) cannot be verified`,
    );
  }
  const missing = SERVER_ROUTED.filter((route) => !conf.includes(route));
  if (missing.length) {
    throw new Error(`${NGINX_DIR}/ no longer routes: ${missing.join(', ')}`);
  }
  return new Set(SERVER_ROUTED);
}

async function main(distDir = 'dist') {
  const broken = [];
  const routed = await serverRoutes();

  for await (const path of walk(distDir)) {
    if (!path.endsWith('.html')) continue;
    const html = await readFile(path, 'utf8');

    for (const m of html.matchAll(/href="([^"]+)"/g)) {
      const href = m[1];
      if (IGNORE.test(href)) continue;
      const clean = href.split('#')[0].split('?')[0];
      if (!clean) continue;
      if (routed.has(clean.replace(/\/$/, ''))) continue;

      const candidates = clean.endsWith('/')
        ? [join(distDir, clean, 'index.html')]
        : [
            join(distDir, clean),
            join(distDir, `${clean}.html`),
            join(distDir, clean, 'index.html'),
          ];

      let ok = false;
      for (const c of candidates)
        if (await exists(c)) {
          ok = true;
          break;
        }
      if (!ok) broken.push(`${path} -> ${href}`);
    }
  }

  if (broken.length) {
    console.error('FAIL: broken internal links');
    for (const b of broken) console.error(`  ${b}`);
    process.exit(1);
  }
  console.log('ok: no broken internal links');
}

await main(process.argv[2]);
