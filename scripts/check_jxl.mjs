#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { promisify } from 'node:util';
import { posixRel, walk } from './lib/fswalk.mjs';
import { ELIGIBLE, protectedPaths } from './lib/jxl.mjs';
import { report, runMain } from './lib/gates.mjs';
import { webpIsLossless } from './make_jxl.mjs';

const require = createRequire(import.meta.url);
const sharp = require('sharp');
const run = promisify(execFile);

async function frames(jxlPath) {
  const { stdout } = await run('jxlinfo', [jxlPath]);
  return Math.max(1, (stdout.match(/^frame:/gm) ?? []).length);
}

async function main(distDir = 'dist') {
  const guarded = await protectedPaths(distDir);
  const problems = [];
  let checked = 0;
  const dir = mkdtempSync(join(tmpdir(), 'check-jxl-'));
  try {
    for await (const path of walk(distDir)) {
      if (!path.endsWith('.jxl')) continue;
      checked += 1;
      const rel = posixRel(distDir, path);
      const base = rel.slice(0, -4);
      const basePath = path.slice(0, -4);
      if (!ELIGIBLE.test(base)) {
        problems.push(`${rel}: not an eligible image path`);
        continue;
      }
      if (guarded.has(base)) {
        problems.push(`${rel}: ${base} is protected and must not have a JPEG XL copy`);
        continue;
      }
      if (!existsSync(basePath)) {
        problems.push(`${rel}: no ${base} beside it`);
        continue;
      }
      const jxl = await readFile(path);
      const orig = await readFile(basePath);
      if (jxl.length >= orig.length)
        problems.push(`${rel}: ${jxl.length} B is not smaller than ${base} (${orig.length} B)`);

      const png = join(dir, `${checked}.png`);
      try {
        await run('djxl', [path, png, '--quiet']);
      } catch (e) {
        problems.push(`${rel}: does not decode (${String(e.stderr ?? e.message).trim()})`);
        continue;
      }
      const om = await sharp(orig, { animated: true }).metadata();
      const origFrames = om.pages ?? 1;
      const jxlFrames = await frames(path);
      const dm = await sharp(png).metadata();
      if (dm.width !== om.width || dm.height !== (om.pageHeight ?? om.height)) {
        problems.push(
          `${rel}: decodes to ${dm.width}x${dm.height}, ${base} is ${om.width}x${om.pageHeight ?? om.height}`,
        );
      }
      if (jxlFrames !== origFrames)
        problems.push(`${rel}: ${jxlFrames} frame(s), ${base} has ${origFrames}`);

      const ext = extname(base).toLowerCase();
      const lossless =
        ext === '.png' || ext === '.gif' || (ext === '.webp' && webpIsLossless(orig));
      if (lossless) {
        const a = await sharp(png).ensureAlpha().raw().toBuffer();
        const b = await sharp(orig, { page: 0 }).ensureAlpha().raw().toBuffer();
        if (!a.equals(b)) problems.push(`${rel}: pixels differ from lossless ${base}`);
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  report(
    'JPEG XL copies',
    problems,
    `ok: ${checked} JPEG XL copies decode, are smaller, and leave protected images alone`,
  );
}

await runMain(import.meta.url, main);
