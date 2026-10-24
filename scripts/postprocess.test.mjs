import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { walk, posixRel } from './lib/fswalk.mjs';
import addPlaceholders from './add_placeholders.mjs';
import extractInlineScripts from './extract_inline_scripts.mjs';
import extractSharedStyles from './extract_shared_styles.mjs';
import hashButtons from './hash_buttons.mjs';
import katexAssets from './katex_assets.mjs';
import optimizeAssets from './optimize_assets.mjs';
import precompress from './precompress.mjs';
import writeSecurityTxt from './security_txt.mjs';
import writeWellKnownButton from './well_known_button.mjs';

const fontTools =
  spawnSync('python3', ['-c', 'import fontTools.subset'], { stdio: 'ignore' }).status === 0;

async function snapshot(dist) {
  const files = new Map();
  for await (const path of walk(dist)) files.set(posixRel(dist, path), await readFile(path));
  return files;
}

async function fixture() {
  const dist = await mkdtemp(join(tmpdir(), 'postprocess-'));
  for (const dir of ['_astro', 'js', 'buttons']) await mkdir(join(dist, dir));
  const png = (width, height, channels = 3) =>
    sharp({ create: { width, height, channels, background: '#6a8caf' } }).png();
  await writeFile(join(dist, '_astro', 'big.abcdefgh.png'), await png(480, 240).toBuffer());
  await writeFile(
    join(dist, 'photo.jpg'),
    await sharp({
      create: { width: 400, height: 300, channels: 3, background: '#335577' },
    })
      .jpeg({ quality: 98 })
      .toBuffer(),
  );
  await writeFile(join(dist, 'buttons', 'duplexsystem.png'), await png(88, 31).toBuffer());
  await mkdir(join(dist, 'buttons', 'sub'));
  await writeFile(join(dist, 'buttons', 'a.png'), await png(88, 31).toBuffer());
  await writeFile(join(dist, 'buttons', 'sub', 'a.png'), await png(88, 31, 4).toBuffer());
  await writeFile(
    join(dist, '_astro', 'a.css'),
    '/* c */\n.a {\n  color: #ff0000;\n  background: url("/buttons/a.png");\n}\n',
  );
  await writeFile(join(dist, 'js', 'crack-email.js'), '// c\nconsole.log( 1 );\n');
  await writeFile(join(dist, 'js', 'code-blocks.js'), '// c\nconsole.log( 2 );\n');
  const math =
    '<span class="katex"><span class="katex-html" aria-hidden="true">' +
    '<span class="mord mathnormal">x</span></span></span>';
  const page = (body) =>
    '<!doctype html><html><head><title>t</title>' +
    '<meta property="og:image" content="https://duplexsystem.org/photo.jpg">' +
    '<link rel="stylesheet" href="/_astro/a.css">' +
    '<script src="/js/crack-email.js" defer></script></head><body>' +
    `<img src="/_astro/big.abcdefgh.png" width="480" height="240" alt="">` +
    '<img src="/buttons/a.png" width="88" height="31" alt="">' +
    '<img src="/buttons/sub/a.png" width="88" height="31" alt="">' +
    '<img src="/photo.jpg" width="400" height="300" alt="">' +
    `<p>__BUTTON_DATA_URI__ __BUTTON_SHA256__</p>${body}</body></html>`;
  await writeFile(join(dist, 'index.html'), page(''));
  await mkdir(join(dist, 'm'));
  await writeFile(join(dist, 'm', 'index.html'), page(math));
  await writeFile(
    join(dist, 'feed.json'),
    '{"c":"<img src=\\"https://duplexsystem.org/photo.jpg\\">"}',
  );
  return dist;
}

const steps = [
  addPlaceholders,
  extractInlineScripts,
  ...(fontTools ? [katexAssets] : []),
  extractSharedStyles,
  optimizeAssets,
  writeWellKnownButton,
  hashButtons,
  writeSecurityTxt,
  precompress,
];

describe('postprocess steps', () => {
  it('leave their own output as it is when run again', async () => {
    const dist = await fixture();
    const log = console.log;
    console.log = () => {};
    try {
      for (const step of steps) await step(dist);
      const once = await snapshot(dist);
      for (const step of steps) await step(dist);
      const twice = await snapshot(dist);
      expect([...twice.keys()].sort()).toEqual([...once.keys()].sort());
      for (const [name, bytes] of once) expect(twice.get(name).equals(bytes), name).toBe(true);

      const html = (await readFile(join(dist, 'index.html'), 'utf8')).replace(/></g, '>\n<');
      expect(html.match(/class="ph__b"/g)).toHaveLength(2);
      expect(html.match(/blocking="render"/g)).toHaveLength(1);
      expect(html).toContain('https://duplexsystem.org/photo.webp');
      expect(html).toMatch(/\/buttons\/a\.[0-9a-f]{8}\.png/);
      expect(html).toMatch(/\/buttons\/sub\/a\.[0-9a-f]{8}\.png/);
      expect(await readFile(join(dist, 'feed.json'), 'utf8')).toContain(
        'duplexsystem.org/photo.webp',
      );
      if (fontTools) {
        const math = await readFile(join(dist, 'm', 'index.html'), 'utf8');
        expect(math.match(/href="\/_astro\/katex\.[0-9a-f]{8}\.css"/g)).toHaveLength(1);
      }
    } finally {
      console.log = log;
      await rm(dist, { recursive: true, force: true });
    }
  }, 60_000);

  it('optimize_assets keeps a camera JPEG upright in its WebP', async () => {
    const dist = await mkdtemp(join(tmpdir(), 'postprocess-'));
    const log = console.log;
    console.log = () => {};
    try {
      const sideways = await sharp({
        create: { width: 600, height: 300, channels: 3, background: '#335577' },
      })
        .jpeg({ quality: 98 })
        .withMetadata({ orientation: 6 })
        .toBuffer();
      await writeFile(join(dist, 'cam.jpg'), sideways);
      await optimizeAssets(dist);
      const meta = await sharp(await readFile(join(dist, 'cam.webp'))).metadata();
      expect([meta.width, meta.height]).toEqual([300, 600]);
    } finally {
      console.log = log;
      await rm(dist, { recursive: true, force: true });
    }
  });

  it('hash_buttons does nothing without a buttons folder', async () => {
    const dist = await mkdtemp(join(tmpdir(), 'postprocess-'));
    const log = console.log;
    console.log = () => {};
    try {
      expect(await hashButtons(dist)).toEqual({ hashed: 0 });
    } finally {
      console.log = log;
      await rm(dist, { recursive: true, force: true });
    }
  });
});
