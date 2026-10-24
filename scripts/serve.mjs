#!/usr/bin/env node
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize, relative, sep } from 'node:path';
import { REPO_ROOT } from './lib/gates.mjs';
import { ELIGIBLE } from './lib/jxl.mjs';

const DIST = process.argv[2] ?? join(REPO_ROOT, 'dist');
const PORT = Number(process.env.PORT ?? 4321);

async function securityHeaders() {
  const conf = await readFile(join(REPO_ROOT, 'nginx/headers.conf'), 'utf8');
  const headers = {};
  for (const m of conf.matchAll(
    /^add_header\s+(\S+)\s+(?:"((?:[^"\\]|\\.)*)"|(\S+?))\s*(?:always)?;/gm,
  )) {
    headers[m[1]] = m[2] ?? m[3];
  }
  if (!Object.keys(headers).length) throw new Error('nginx/headers.conf: no add_header found');
  return headers;
}
const SECURITY_HEADERS = await securityHeaders();

const TYPE_OF_PATH = {
  '/manifest.webmanifest': 'application/manifest+json',
  '/feed.json': 'application/feed+json',
};

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
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.jxl': 'image/jxl',
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
const isFile = async (p) => (await exists(p)) && (await stat(p)).isFile();
const isDir = async (p) => (await exists(p)) && (await stat(p)).isDirectory();

async function resolve(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0]);
  } catch {
    return { status: 400 };
  }
  const clean = normalize(decoded).replace(/^(\.\.[/\\])+/, '');
  for (const candidate of [
    join(DIST, clean),
    join(DIST, clean, 'index.html'),
    join(DIST, `${clean}.html`),
  ]) {
    if (!(await isFile(candidate))) continue;
    const viaDirectory = candidate.endsWith('index.html') && !clean.endsWith('index.html');
    if (viaDirectory && !clean.endsWith('/') && (await isDir(join(DIST, clean)))) {
      return { status: 301, location: `${clean}/` };
    }
    return { file: candidate };
  }
  return { status: 404 };
}

async function negotiate(path, accept) {
  if (accept.includes('br') && (await exists(`${path}.br`))) return [`${path}.br`, 'br'];
  if (accept.includes('gzip') && (await exists(`${path}.gz`))) return [`${path}.gz`, 'gzip'];
  return [path, null];
}

const IMMUTABLE = [
  /^\/_astro\//,
  /^\/embeds\//,
  /^\/buttons\/.+\.[0-9a-f]{8}\.[a-z]+$/,
  /^\/js\/.+\.[0-9a-f]{8}\.js$/,
  /^\/pagefind\/(fragment\/|index\/|.+\.[0-9a-f]{8}\.[a-z]+$|.+_[0-9a-f]{10}\.pf_meta$)/,
];
const IMMUTABLE_ORIGINS = /^\/_astro\//;
function cacheControl(path) {
  if (IMMUTABLE.some((re) => re.test(path))) return 'public, max-age=31536000, immutable';
  return 'public, max-age=0, must-revalidate';
}

const ACCEPTS_JXL = /image\/jxl(?!\s*;\s*q\s*=\s*0(?:\.0*)?\s*(?:[,;]|$))/i;

async function respond(req, res) {
  const resolved = await resolve(req.url ?? '/');
  if (resolved.status === 301) {
    const query = (req.url ?? '').includes('?') ? `?${req.url.split('?').slice(1).join('?')}` : '';
    res.writeHead(301, { ...SECURITY_HEADERS, Location: resolved.location + query });
    res.end();
    return;
  }
  let { file, status = 200 } = resolved;
  if (!file) file = join(DIST, 'errors', String(status), 'index.html');
  const sitePath = `/${relative(DIST, file).split(sep).join('/')}`;

  const headers = {
    ...SECURITY_HEADERS,
    'Content-Type':
      TYPE_OF_PATH[sitePath] ?? TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'Cache-Control': cacheControl(sitePath),
  };
  if (IMMUTABLE_ORIGINS.test(sitePath)) headers['Access-Control-Allow-Origin'] = '*';

  let served = file;
  let encoding = null;
  if (
    ELIGIBLE.test(sitePath.slice(1)) &&
    ACCEPTS_JXL.test(req.headers.accept ?? '') &&
    (await exists(`${file}.jxl`))
  ) {
    served = `${file}.jxl`;
    headers['Content-Type'] = 'image/jxl';
    headers.Vary = 'Accept';
  } else if (!/^image\//.test(headers['Content-Type'])) {
    [served, encoding] = await negotiate(file, req.headers['accept-encoding'] ?? '');
  }
  if (encoding) {
    headers['Content-Encoding'] = encoding;
    headers.Vary = 'Accept-Encoding';
  }

  const body = await readFile(served);
  res.writeHead(status, headers);
  res.end(body);
}

createServer((req, res) => {
  respond(req, res).catch((err) => {
    console.error(`${req.url}: ${err.message}`);
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('500 internal error\n');
  });
}).listen(PORT, () => {
  console.log(`serving ${DIST} on http://localhost:${PORT}`);
  console.log('mimics nginx: try_files, brotli_static/gzip_static, JPEG XL, headers, cache');
});
