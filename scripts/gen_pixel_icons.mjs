#!/usr/bin/env node
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isMain } from './lib/main.mjs';
import { writeIfChanged } from './lib/write.mjs';
import { ICONS } from '../src/assets/icons/pixel-icons.mjs';

const OUT = fileURLToPath(new URL('../src/assets/icons/generated/', import.meta.url));

export function iconSvg(rows) {
  if (!rows.length) throw new Error('pixel icon has no rows');
  if (rows.some((r) => !/^[#.]+$/.test(r))) throw new Error('pixel icon rows use only # and .');
  const width = rows[0].length;
  if (rows.some((r) => r.length !== width)) {
    throw new Error(`pixel icon rows differ in width (${rows.map((r) => r.length).join(', ')})`);
  }
  let d = '';
  rows.forEach((row, y) => {
    for (const m of row.matchAll(/#+/g)) d += `M${m.index} ${y}h${m[0].length}v1H${m.index}z`;
  });
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${rows.length}" ` +
    `shape-rendering="crispEdges"><path d="${d}"/></svg>\n`
  );
}

export function generate(icons = ICONS, out = OUT) {
  mkdirSync(out, { recursive: true });
  const names = new Set(Object.keys(icons).map((n) => `${n}.svg`));
  for (const f of readdirSync(out)) if (!names.has(f)) rmSync(`${out}/${f}`);
  for (const [name, rows] of Object.entries(icons)) {
    try {
      writeIfChanged(`${out}/${name}.svg`, iconSvg(rows));
    } catch (e) {
      throw new Error(`${name}: ${e.message}`);
    }
  }
  return names.size;
}

if (isMain(import.meta.url)) {
  console.log(`pixel icons: ${generate()} written to src/assets/icons/generated/`);
}
