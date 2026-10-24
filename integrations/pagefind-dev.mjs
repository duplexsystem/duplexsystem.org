import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs';
import {
  basename,
  dirname,
  extname,
  join,
  normalize,
  relative,
  resolve,
  isAbsolute,
} from 'node:path';

const TYPES = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.pf_fragment': 'application/octet-stream',
  '.pf_index': 'application/octet-stream',
  '.pf_meta': 'application/octet-stream',
};

function hashedSibling(file) {
  const ext = extname(file);
  const stem = basename(file, ext);
  const pattern = new RegExp(
    `^${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.[0-9a-f]{8}\\${ext}$`,
  );
  try {
    const hit = readdirSync(dirname(file)).find((f) => pattern.test(f));
    return hit ? join(dirname(file), hit) : null;
  } catch {
    return null;
  }
}

export function pagefindDev() {
  return {
    name: 'pagefind-dev',
    hooks: {
      'astro:server:setup': ({ server, logger }) => {
        const root = resolve('dist/pagefind');

        if (!existsSync(root)) {
          logger.warn('dist/pagefind not found: run `npm run build` once to enable search in dev');
        }

        server.middlewares.use('/pagefind', (req, res, next) => {
          const rel = normalize(decodeURIComponent((req.url ?? '/').split('?')[0]));
          let file = join(root, rel);
          const inside = relative(root, file);
          if (inside.startsWith('..') || isAbsolute(inside)) return next();
          if (!existsSync(file)) file = hashedSibling(file) ?? file;
          if (!existsSync(file) || !statSync(file).isFile()) return next();

          res.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream');
          createReadStream(file).pipe(res);
        });
      },
    },
  };
}
