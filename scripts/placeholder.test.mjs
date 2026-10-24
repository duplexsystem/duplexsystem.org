import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { placeholderStyle } from './placeholder.mjs';

const photo = () =>
  sharp({ create: { width: 400, height: 225, channels: 3, background: '#c0507a' } })
    .png()
    .toBuffer();

const svgOf = (style) =>
  decodeURIComponent(/^url\("data:image\/svg\+xml,(.*)"\)$/.exec(style.backgroundImage)[1]);

describe('placeholderStyle', () => {
  it('is a stretched SVG, keeping the image aspect ratio in its viewBox', async () => {
    const style = await placeholderStyle(await photo());
    expect(style.backgroundSize).toBe('100% 100%');
    expect(svgOf(style)).toMatch(/viewBox='0 0 16 9'/);
  });

  it('blurs a padded thumbnail, so edges keep their colour instead of fading', async () => {
    const svg = svgOf(await placeholderStyle(await photo()));
    expect(svg).toMatch(/<feGaussianBlur stdDeviation='0\.8'\/>/);
    expect(svg).toMatch(/<image x='-2' y='-2' width='20' height='13'/);
    expect(svg).toMatch(/href='data:image\/webp;base64,[A-Za-z0-9+/=]+'/);
  });

  it('is null for an image with transparency, which a blur would show through', async () => {
    const clear = await sharp({
      create: {
        width: 400,
        height: 225,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0.5 },
      },
    })
      .png()
      .toBuffer();
    expect(await placeholderStyle(clear)).toBeNull();
  });

  it('needs no escaping inside a double-quoted style attribute or url("")', async () => {
    const { backgroundImage } = await placeholderStyle(await photo());
    expect(backgroundImage.slice(5, -2)).not.toMatch(/["'\s<>]/);
  });

  it('takes its shape from the image as drawn, after EXIF orientation', async () => {
    const turned = await sharp({
      create: { width: 400, height: 200, channels: 3, background: '#c0507a' },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    expect(svgOf(await placeholderStyle(turned))).toMatch(/viewBox='0 0 16 32'/);
  });
});
