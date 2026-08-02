import { createRequire } from 'node:module';
import { encode } from 'blurhash';
import { blurhashToCss } from 'blurhash-to-css';

const sharp = createRequire(import.meta.url)('sharp');

export async function blurhashCss(src) {
  const { data, info } = await sharp(src)
    .raw()
    .ensureAlpha()
    .resize(32, 32, { fit: 'inside' })
    .toBuffer({ resolveWithObject: true });
  const hash = encode(new Uint8ClampedArray(data), info.width, info.height, 4, 3);
  return blurhashToCss(hash);
}
