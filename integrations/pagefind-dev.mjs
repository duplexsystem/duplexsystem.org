import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';

// Pagefind ships WASM and its own binary index formats; the wrong Content-Type
// breaks the widget with no error to show for it.
const TYPES = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.pf_fragment': 'application/octet-stream',
  '.pf_index': 'application/octet-stream',
  '.pf_meta': 'application/octet-stream',
};

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
          const file = join(root, rel);
          if (!file.startsWith(root)) return next();
          if (!existsSync(file) || !statSync(file).isFile()) return next();

          res.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream');
          createReadStream(file).pipe(res);
        });
      },
    },
  };
}
