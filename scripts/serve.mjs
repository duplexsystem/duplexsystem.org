#!/usr/bin/env node
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';

const DIST = 'dist';
const PORT = Number(process.env.PORT ?? 4321);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.pagefind': 'application/octet-stream',
};

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/** nginx: try_files $uri $uri/index.html $uri.html =404 */
async function resolve(urlPath) {
  const clean = normalize(decodeURIComponent(urlPath.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  for (const candidate of [
    join(DIST, clean),
    join(DIST, clean, 'index.html'),
    join(DIST, `${clean}.html`),
  ]) {
    if ((await exists(candidate)) && (await stat(candidate)).isFile()) return candidate;
  }
  return null;
}

/** nginx: brotli_static on; gzip_static on; */
async function negotiate(path, accept) {
  if (accept.includes('br') && (await exists(`${path}.br`))) return [`${path}.br`, 'br'];
  if (accept.includes('gzip') && (await exists(`${path}.gz`))) return [`${path}.gz`, 'gzip'];
  return [path, null];
}

function cacheControl(path) {
  if (path.includes('/_astro/')) return 'public, max-age=31536000, immutable';
  if (/\.(html|txt)$/.test(path)) return 'public, max-age=0, must-revalidate';
  if (path.includes('/fonts/')) return 'public, max-age=604800';
  return 'public, max-age=3600';
}

createServer(async (req, res) => {
  let file = await resolve(req.url ?? '/');
  let status = 200;
  if (!file) {
    file = join(DIST, '404.html');
    status = 404;
  }

  const [served, encoding] = await negotiate(file, req.headers['accept-encoding'] ?? '');
  const body = await readFile(served);

  const headers = {
    'Content-Type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'Cache-Control': cacheControl(file),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  };
  if (encoding) {
    headers['Content-Encoding'] = encoding;
    headers.Vary = 'Accept-Encoding';
  }

  res.writeHead(status, headers);
  res.end(body);
}).listen(PORT, () => {
  console.log(`serving ./${DIST} on http://localhost:${PORT}`);
  console.log('mimics nginx: try_files, brotli_static/gzip_static, cache headers');
});
