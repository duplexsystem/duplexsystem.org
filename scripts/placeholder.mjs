import { createRequire } from 'node:module';

const sharp = createRequire(import.meta.url)('sharp');

const WIDTH = 16;
const BLUR = 0.8;
const PAD = 2;
const BACKGROUND = '#0f0b16';

export async function placeholderStyle(src) {
  if (!(await sharp(src).stats()).isOpaque) return null;
  const meta = await sharp(src).metadata();
  const [width, height] =
    meta.orientation >= 5 ? [meta.height, meta.width] : [meta.width, meta.height];
  const w = WIDTH;
  const h = Math.max(2, Math.round((w * height) / width));
  const thumb = await sharp(src)
    .rotate()
    .flatten({ background: BACKGROUND })
    .resize(w, h, { fit: 'fill' })
    .extend({ top: PAD, bottom: PAD, left: PAD, right: PAD, extendWith: 'copy' })
    .webp({ lossless: true, effort: 6 })
    .toBuffer();
  const [x, y, pw, ph] = [-PAD, -PAD, w + 2 * PAD, h + 2 * PAD];
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${w} ${h}' preserveAspectRatio='none'>` +
    `<filter id='b' x='${x}' y='${y}' width='${pw}' height='${ph}' filterUnits='userSpaceOnUse' color-interpolation-filters='sRGB'>` +
    `<feGaussianBlur stdDeviation='${BLUR}'/></filter>` +
    `<image x='${x}' y='${y}' width='${pw}' height='${ph}' preserveAspectRatio='none' filter='url(#b)' ` +
    `href='data:image/webp;base64,${thumb.toString('base64')}'/></svg>`;
  const uri = encodeURIComponent(svg).replace(/'/g, '%27');
  return { backgroundImage: `url("data:image/svg+xml,${uri}")`, backgroundSize: '100% 100%' };
}
