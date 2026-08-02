#!/usr/bin/env python3
"""Draw src/assets/og-default.png, the fallback social card.

Run by hand after a brand change; the result is committed, not built.

The mark is redrawn here rather than rasterized from logo/mark-dither.svg,
which colors itself through a CSS variable no rasterizer resolves.
"""

import io
import math
import pathlib

from PIL import Image, ImageChops, ImageDraw, ImageFont
from fontTools.ttLib import TTFont

ROOT = pathlib.Path(__file__).resolve().parent.parent
FONTS = ROOT / "src/assets/fonts/source"
OUT = ROOT / "src/assets/og-default.png"

W, H = 1200, 630
BG = (15, 11, 22)
ACC = (180, 140, 255)

WORDMARK = "duplexsystem.org"

STROKE = 7
PATH_A = [(42, 8), (6, 26), (58, 26)]
PATH_B = [(22, 56), (58, 38), (6, 38)]

# Filled 2x2 cells per tile, matching the <pattern> elements in the SVG.
S25 = (8, [(0, 0), (4, 2), (2, 4), (6, 6)])
S50 = (4, [(0, 0), (2, 2)])
S75 = (
    8,
    [
        (0, 2),
        (0, 4),
        (0, 6),
        (2, 0),
        (2, 2),
        (2, 6),
        (4, 0),
        (4, 4),
        (4, 6),
        (6, 0),
        (6, 2),
        (6, 4),
    ],
)
SOLID = None

RAMP_A = [SOLID, S75, S50, S25]
RAMP_B = [S25, S50, S75, SOLID]


def stroke_polygons(points, half):
    """Outline of a polyline stroked with butt caps and bevel joins."""
    polys = []
    normals = []
    for (x0, y0), (x1, y1) in zip(points, points[1:]):
        dx, dy = x1 - x0, y1 - y0
        length = math.hypot(dx, dy)
        nx, ny = -dy / length * half, dx / length * half
        normals.append((nx, ny))
        polys.append(
            [
                (x0 + nx, y0 + ny),
                (x1 + nx, y1 + ny),
                (x1 - nx, y1 - ny),
                (x0 - nx, y0 - ny),
            ]
        )
    for (vx, vy), (n0x, n0y), (n1x, n1y) in zip(points[1:-1], normals, normals[1:]):
        polys.append([(vx, vy), (vx + n0x, vy + n0y), (vx + n1x, vy + n1y)])
        polys.append([(vx, vy), (vx - n0x, vy - n0y), (vx - n1x, vy - n1y)])
    return polys


def dither_band(size, scale, tile):
    """Mask for one vertical quarter of the mark."""
    band = Image.new("1", (size, size), 0)
    if tile is SOLID:
        return Image.new("1", (size, size), 1)
    period, cells = tile
    draw = ImageDraw.Draw(band)
    step = period * scale
    for oy in range(0, size, step):
        for ox in range(0, size, step):
            for cx, cy in cells:
                x, y = ox + cx * scale, oy + cy * scale
                draw.rectangle([x, y, x + 2 * scale - 1, y + 2 * scale - 1], fill=1)
    return band


def ramped(path, ramp, px, scale):
    """One stroke, thinned left to right (or right to left) by its ramp."""
    shape = Image.new("1", (px, px), 0)
    draw = ImageDraw.Draw(shape)
    for poly in stroke_polygons(path, STROKE / 2):
        draw.polygon([(x * scale, y * scale) for x, y in poly], fill=1)

    out = Image.new("1", (px, px), 0)
    quarter = px // 4
    for i, tile in enumerate(ramp):
        box = (i * quarter, 0, (i + 1) * quarter, px)
        band = dither_band(px, scale, tile).crop(box)
        out.paste(ImageChops.logical_and(shape.crop(box), band), box)
    return out


def draw_mark(px):
    """The dithered mark as an alpha mask, px wide. Use a multiple of 32."""
    scale = px // 64
    strokes = ImageChops.logical_or(
        ramped(PATH_A, RAMP_A, px, scale), ramped(PATH_B, RAMP_B, px, scale)
    )
    return strokes.convert("L").point(lambda v: 255 if v else 0)


def load(name, size, weight=None):
    """PIL font from the committed source faces; woff2 is unpacked in memory."""
    path = FONTS / name
    if path.suffix == ".woff2":
        face = TTFont(path)
        face.flavor = None
        buf = io.BytesIO()
        face.save(buf)
        buf.seek(0)
        font = ImageFont.truetype(buf, size)
    else:
        font = ImageFont.truetype(str(path), size)
    if weight is not None:
        font.set_variation_by_axes([weight])
    return font


def crisp(img, xy, text, font, fill):
    """Departure Mono is a pixel face; antialiasing it turns the grid to mush."""
    layer = Image.new("1", img.size, 0)
    ImageDraw.Draw(layer).text(xy, text, font=font, fill=1)
    img.paste(fill, (0, 0), layer)


def main():
    card = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(card)
    draw.rectangle([0, 0, W, 7], fill=ACC)

    # Departure Mono sits on a 10px grid; keep its size a multiple of 10.
    wordmark = load("DepartureMono-Regular.woff2", 50)
    word_box = wordmark.getbbox(WORDMARK)
    mark_px, gutter = 256, 64
    text_w = word_box[2]
    text_h = word_box[3] - word_box[1]

    left = (W - (mark_px + gutter + text_w)) // 2
    card.paste(ACC, (left, (H - mark_px) // 2), draw_mark(mark_px))

    crisp(
        card,
        (left + mark_px + gutter, (H - text_h) // 2 - word_box[1]),
        WORDMARK,
        wordmark,
        ACC,
    )

    card.save(OUT, optimize=True)
    print(f"wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size} bytes, {W}x{H})")


if __name__ == "__main__":
    main()
