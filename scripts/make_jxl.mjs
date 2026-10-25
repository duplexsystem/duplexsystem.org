#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, extname, join, sep } from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { cached } from './lib/cache.mjs';
import { walk, posixRel } from './lib/fswalk.mjs';
import { sha256 } from './lib/hash.mjs';
import { ELIGIBLE, protectedPaths } from './lib/jxl.mjs';
import { isMain } from './lib/main.mjs';
import { mapPool } from './lib/pool.mjs';
const run = promisify(execFile);
const CACHE = '.cache/jxl';
const SOURCE_DIRS = ['public', 'src'];
const RASTER = /\.(png|gif|jpe?g|webp)$/i;

export const sourceStem = (path) => basename(path, extname(path));

export const stem = (path) =>
  sourceStem(path)
    .replace(/\.[\w-]{8}(?:_\w+)?$/, '')
    .replace(/\.still$/, '');

export function webpIsLossless(bytes) {
  const s = bytes.toString('latin1');
  return s.includes('VP8L') && !s.includes('VP8 ');
}

let cjxlInfo;
async function cjxl() {
  if (cjxlInfo !== undefined) return cjxlInfo;
  try {
    const { stdout, stderr } = await run('cjxl', ['--version']);
    const version = (stdout + stderr).trim().split('\n')[0];
    const probe = mkdtempSync(join(tmpdir(), 'jxl-probe-'));
    let effort = null;
    try {
      const png = join(probe, 'p.png');
      await writeFile(
        png,
        await sharp({ create: { width: 1, height: 1, channels: 3, background: '#000' } })
          .png()
          .toBuffer(),
      );
      for (const e of [
        ['-e', '11', '--allow_expert_options'],
        ['-e', '10'],
        ['-e', '9'],
      ]) {
        try {
          await run('cjxl', ['-d', '0', ...e, '--quiet', png, join(probe, 'p.jxl')]);
          effort = e;
          break;
        } catch {
        }
      }
    } finally {
      rmSync(probe, { recursive: true, force: true });
    }
    if (!effort) throw new Error('cjxl takes none of -e 11, 10 or 9');
    cjxlInfo = { version, effort };
  } catch {
    cjxlInfo = null;
  }
  return cjxlInfo;
}

async function encode(input, ext, args) {
  const info = await cjxl();
  const key = sha256(input, ext, JSON.stringify(args), info.version);
  return cached(CACHE, `${key}.jxl`, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'jxl-'));
    try {
      const src = join(dir, `in${ext}`);
      const out = join(dir, 'out.jxl');
      await writeFile(src, input);
      await run('cjxl', [...args, '--quiet', src, out], { maxBuffer: 1 << 26 });
      return await readFile(out);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

async function sourceIndex(repoDir) {
  const index = new Map();
  for (const dir of SOURCE_DIRS) {
    const root = join(repoDir, dir);
    if (!existsSync(root)) continue;
    for await (const path of walk(root)) {
      if (!RASTER.test(path) || path.includes(`${sep}generated${sep}`)) continue;
      const k = sourceStem(path);
      if (!index.has(k)) index.set(k, []);
      index.get(k).push(path);
    }
  }
  return index;
}

const metaOf = async (bytes) => {
  const m = await sharp(bytes, { animated: true }).metadata();
  return {
    width: m.width,
    height: m.pageHeight ?? m.height,
    pages: m.pages ?? 1,
    format: m.format,
  };
};

async function luma(input) {
  const { data, info } = await sharp(input)
    .flatten({ background: '#fff' })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
}

export function ssim(a, b) {
  const C1 = (0.01 * 255) ** 2;
  const C2 = (0.03 * 255) ** 2;
  let sum = 0;
  let n = 0;
  for (let y = 0; y + 8 <= a.h; y += 4) {
    for (let x = 0; x + 8 <= a.w; x += 4) {
      let ma = 0,
        mb = 0;
      for (let j = 0; j < 8; j++)
        for (let i = 0; i < 8; i++) {
          const k = (y + j) * a.w + x + i;
          ma += a.data[k];
          mb += b.data[k];
        }
      ma /= 64;
      mb /= 64;
      let va = 0,
        vb = 0,
        cov = 0;
      for (let j = 0; j < 8; j++)
        for (let i = 0; i < 8; i++) {
          const k = (y + j) * a.w + x + i;
          const da = a.data[k] - ma,
            db = b.data[k] - mb;
          va += da * da;
          vb += db * db;
          cov += da * db;
        }
      va /= 63;
      vb /= 63;
      cov /= 63;
      sum += ((2 * ma * mb + C1) * (2 * cov + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2));
      n += 1;
    }
  }
  return n ? sum / n : 1;
}

async function decodeJxl(bytes) {
  const dir = mkdtempSync(join(tmpdir(), 'jxl-dec-'));
  try {
    await writeFile(join(dir, 'a.jxl'), bytes);
    await run('djxl', [join(dir, 'a.jxl'), join(dir, 'a.png'), '--quiet']);
    return await readFile(join(dir, 'a.png'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const DISTANCES = [0.5, 1, 1.5, 2, 2.5, 3, 4];

export const lossyArgs = (d) => ['-d', String(d), '-e', '7', '--progressive_dc=1'];

async function matchedLossy(refPng, builtBytes) {
  const info = await cjxl();
  const verdict = `${sha256(refPng, builtBytes, JSON.stringify(DISTANCES.map(lossyArgs)), info.version, 'ssim')}.json`;
  const { passing } = JSON.parse(
    await cached(CACHE, verdict, async () => {
      const ref = await luma(refPng);
      const bar = ssim(ref, await luma(builtBytes));
      const scores = await Promise.all(
        DISTANCES.map(async (d) =>
          ssim(ref, await luma(await decodeJxl(await encode(refPng, '.png', lossyArgs(d))))),
        ),
      );
      const failing = scores.findIndex((score) => score < bar);
      return JSON.stringify({ passing: failing === -1 ? DISTANCES.length : failing });
    }),
  );
  const out = [];
  for (const d of DISTANCES.slice(0, passing)) {
    out.push({ bytes: await encode(refPng, '.png', lossyArgs(d)) });
  }
  return out;
}

async function candidates(built, builtBytes, sources) {
  const info = await cjxl();
  const lossless = ['-d', '0', ...info.effort];
  const meta = await metaOf(builtBytes);
  const ext = extname(built).toLowerCase();
  const lossyBuilt =
    ext === '.jpg' || ext === '.jpeg' || (ext === '.webp' && !webpIsLossless(builtBytes));

  let src = null;
  let larger = null;
  for (const path of sources.get(stem(built)) ?? []) {
    const bytes = await readFile(path);
    const m = await metaOf(bytes);
    if (
      m.width === meta.width &&
      m.height === meta.height &&
      (m.pages === meta.pages || meta.pages === 1)
    ) {
      src = { path, bytes, meta: m };
      break;
    }
    const sameShape = Math.abs(m.width / m.height - meta.width / meta.height) < 0.01;
    if (!larger && m.pages === 1 && m.width > meta.width && sameShape)
      larger = { path, bytes, meta: m };
  }

  const out = [];
  if (meta.pages > 1) {
    if (src && src.meta.pages === meta.pages && /\.(gif|png)$/i.test(src.path)) {
      out.push({ bytes: await encode(src.bytes, extname(src.path), lossless) });
    }
    return out;
  }
  if (src) {
    const sext = extname(src.path).toLowerCase();
    if (sext === '.jpg' || sext === '.jpeg') {
      out.push({
        bytes: await encode(src.bytes, sext, ['--lossless_jpeg=1', '-e', '9']),
      });
      if (lossyBuilt)
        out.push(...(await matchedLossy(await sharp(src.bytes).png().toBuffer(), builtBytes)));
    } else {
      const toPng = src.meta.pages > 1 || sext === '.webp';
      const input = toPng ? await sharp(src.bytes, { page: 0 }).png().toBuffer() : src.bytes;
      if (!lossyBuilt)
        out.push({
          bytes: await encode(input, toPng ? '.png' : sext, lossless),
        });
      else out.push(...(await matchedLossy(await sharp(input).png().toBuffer(), builtBytes)));
    }
    return out;
  }
  if (larger && lossyBuilt) {
    const ref = await sharp(larger.bytes)
      .resize(meta.width, meta.height, { kernel: 'lanczos3' })
      .png()
      .toBuffer();
    out.push(...(await matchedLossy(ref, builtBytes)));
    return out;
  }
  if (ext === '.jpg' || ext === '.jpeg')
    out.push({
      bytes: await encode(builtBytes, ext, ['--lossless_jpeg=1', '-e', '9']),
    });
  else if (!lossyBuilt) {
    const input = ext === '.webp' ? await sharp(builtBytes).png().toBuffer() : builtBytes;
    out.push({
      bytes: await encode(input, ext === '.webp' ? '.png' : ext, lossless),
    });
  }
  return out;
}

export default async function makeJxl(distDir = 'dist', repoDir = '.') {
  const info = await cjxl();
  if (!info) {
    console.log('jxl: cjxl not found, no JPEG XL copies (install libjxl-utils / libjxl-tools)');
    return { written: 0, saved: 0 };
  }
  const guarded = await protectedPaths(distDir, repoDir);
  const sources = await sourceIndex(repoDir);
  const eligible = [];
  const copies = [];
  for await (const path of walk(distDir)) {
    const rel = posixRel(distDir, path);
    if (ELIGIBLE.test(rel) && !guarded.has(rel)) eligible.push({ path, rel });
    else if (rel.endsWith('.jxl')) copies.push({ path, original: rel.slice(0, -4) });
  }
  const live = new Set(eligible.map((e) => e.rel));
  for (const { path, original } of copies) if (!live.has(original)) await rm(path, { force: true });

  let written = 0;
  let saved = 0;
  await mapPool(
    eligible,
    async ({ path, rel }) => {
      const bytes = await readFile(path);
      const best = (await candidates(rel, bytes, sources)).sort(
        (a, b) => a.bytes.length - b.bytes.length,
      )[0];
      if (best && best.bytes.length < bytes.length) {
        await writeFile(`${path}.jxl`, best.bytes);
        written += 1;
        saved += bytes.length - best.bytes.length;
      } else {
        await rm(`${path}.jxl`, { force: true });
      }
    },
    4,
  );
  console.log(
    `jxl: ${written}/${eligible.length} images got a smaller JPEG XL copy, ${saved} B less for JXL browsers (${info.version}, ${info.effort.join(' ')})`,
  );
  return { written, saved };
}

if (isMain(import.meta.url)) {
  await makeJxl(process.argv[2]);
}
