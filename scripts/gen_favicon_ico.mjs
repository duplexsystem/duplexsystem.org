#!/usr/bin/env node
import sharp from 'sharp';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { writeIfChanged } from './lib/write.mjs';

const pub = (name) => fileURLToPath(new URL(`../public/${name}`, import.meta.url));
const SVG = pub('favicon.svg');
const OUT = pub('favicon.ico');
const SIZES = [16, 32, 48];

const BG = '#0f0b16';
const ACCENT = '#b48cff';

function encodeIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const dir = Buffer.alloc(16 * images.length);
  let offset = 6 + dir.length;
  images.forEach((img, i) => {
    const b = i * 16;
    dir.writeUInt8(img.size >= 256 ? 0 : img.size, b + 0);
    dir.writeUInt8(img.size >= 256 ? 0 : img.size, b + 1);
    dir.writeUInt8(0, b + 2);
    dir.writeUInt8(0, b + 3);
    dir.writeUInt16LE(1, b + 4);
    dir.writeUInt16LE(32, b + 6);
    dir.writeUInt32LE(img.png.length, b + 8);
    dir.writeUInt32LE(offset, b + 12);
    offset += img.png.length;
  });
  return Buffer.concat([header, dir, ...images.map((i) => i.png)]);
}

const svg = await readFile(SVG);

const { data, info } = await sharp(svg)
  .resize(16, 16, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
if (info.channels !== 4) throw new Error(`expected RGBA, got ${info.channels} channels`);

let partial = 0;
for (let i = 3; i < data.length; i += 4) {
  const a = data[i];
  if (a !== 0 && a !== 255) partial++;
  data[i] = a >= 128 ? 255 : 0;
}
if (partial) {
  console.warn(
    `gen_favicon_ico: rasterizer produced ${partial} anti-aliased pixel(s); hard-thresholded to keep the mark crisp`,
  );
}

const base16 = sharp(data, { raw: { width: 16, height: 16, channels: 4 } });

const images = [];
for (const size of SIZES) {
  const pipe =
    size === 16 ? base16.clone() : base16.clone().resize(size, size, { kernel: 'nearest' });
  images.push({ size, png: await pipe.png({ compressionLevel: 9 }).toBuffer() });
}

const ico = encodeIco(images);
writeIfChanged(OUT, ico);
console.log(
  `gen_favicon_ico: ${SIZES.join('/')}px favicon.ico, ${ico.length} bytes, from public/favicon.svg`,
);

const TILES = [
  { out: pub('apple-touch-icon.png'), size: 180, scale: 8 },
  { out: pub('icon-192.png'), size: 192, scale: 8 },
  { out: pub('icon-512.png'), size: 512, scale: 24 },
];
for (const { out, size, scale } of TILES) {
  const mark = await base16
    .clone()
    .resize(16 * scale, 16 * scale, { kernel: 'nearest' })
    .png()
    .toBuffer();
  const png = await sharp({ create: { width: size, height: size, channels: 4, background: BG } })
    .composite([{ input: mark, gravity: 'centre' }])
    .png({ compressionLevel: 9, palette: true })
    .toBuffer();
  writeIfChanged(out, png);
}
console.log(`gen_favicon_ico: ${TILES.map((t) => `${t.size}px`).join('/')} touch icons`);

const marks = svg.toString().match(/<rect\b[^>]*\/>/g);
if (!marks?.length) throw new Error(`gen_favicon_ico: no <rect>s in ${SVG}`);
const tile = [
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-4 -4 24 24" shape-rendering="crispEdges">',
  `<rect x="-4" y="-4" width="24" height="24" fill="${BG}"/>`,
  `<g fill="${ACCENT}">${marks.join('')}</g>`,
  '</svg>\n',
].join('');
writeIfChanged(pub('icon.svg'), tile);
console.log(`gen_favicon_ico: icon.svg, ${tile.length} bytes`);
