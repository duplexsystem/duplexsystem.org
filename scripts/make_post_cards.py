#!/usr/bin/env python3

import io
import json
import os
import pathlib
import re
import subprocess
import sys

import yaml
from PIL import Image, ImageDraw

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import make_og_card as base  # noqa: E402

ROOT = base.ROOT
POSTS = ROOT / "src/content/blog"
OUT_DIR = ROOT / "src/assets/og/generated"

W, H = base.W, base.H
BG = base.BG
ACC = base.ACC
PANEL = (23, 17, 31)
CODE = (19, 14, 28)
INK = (221, 212, 234)
MUT = (154, 144, 176)


def over(rgb, alpha, under=BG):
    return tuple(round(c * alpha + u * (1 - alpha)) for c, u in zip(rgb, under))


EDGE = over((255, 255, 255), 0.14)
LINE = over((255, 255, 255), 0.09, PANEL)

SMALL = 22
TITLE_SIZES = (88, 77, 66, 55)

M = 56
CELL = 4
BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]


def front_matter(text):
    m = re.match(r"^---\n(.*?)\n---\n", text, re.S)
    return (yaml.safe_load(m.group(1)) if m else {}), text[m.end() :] if m else text


def read_minutes(bodies):
    js = (
        "const { readingTime } = await import('./src/lib/reading-time.ts');"
        "const bodies = JSON.parse(await new Response(process.stdin).text());"
        "console.log(JSON.stringify(Object.fromEntries("
        "Object.entries(bodies).map(([k, v]) => [k, readingTime(v).minutes]))));"
    )
    out = subprocess.run(
        ["node", "--experimental-strip-types", "--no-warnings", "--input-type=module", "-e", js],
        input=json.dumps(bodies),
        capture_output=True,
        text=True,
        cwd=ROOT,
        check=True,
    )
    return json.loads(out.stdout)


def spaced(img, xy, text, font, fill, track):
    x, y = xy
    for ch in text:
        base.crisp(img, (round(x), y), ch, font, fill)
        x += font.getlength(ch) + track


def wrap(title, font, width):
    lines, cur = [], ""
    for word in title.split():
        test = f"{cur} {word}".strip()
        if font.getlength(test) <= width:
            cur = test
        elif not cur or font.getlength(word) > width:
            return None
        else:
            lines.append(cur)
            cur = word
    lines.append(cur)
    return lines


def dither_mask(w, h, fade):
    mask = Image.new("1", (w, h), 1)
    draw = ImageDraw.Draw(mask)
    rows = fade // CELL
    top = h - fade
    for r in range(rows):
        level = 16 * (1 - (r + 0.5) / rows)
        for c in range(0, w // CELL + 1):
            if BAYER[r % 4][c % 4] >= level:
                x, y = c * CELL, top + r * CELL
                draw.rectangle([x, y, x + CELL - 1, y + CELL - 1], fill=0)
    return mask


def card(meta, minutes):
    img = Image.new("RGB", (W, H), BG)
    small = base.load("DepartureMono-Regular.woff2", SMALL)

    win = Image.new("RGB", (W, H), BG)
    wd = ImageDraw.Draw(win)
    left, right, top = M, W - M, M
    wd.rounded_rectangle([left, top, right, H + 40], radius=8, fill=EDGE)
    wd.rounded_rectangle([left + 2, top + 2, right - 2, H + 40], radius=6, fill=PANEL)
    mask = Image.new("1", (W, H), 0)
    mask.paste(dither_mask(right - left + 1, H - top, 150), (left, top))
    edge = mask.crop((left, top, left + CELL, H)).transpose(Image.FLIP_LEFT_RIGHT)
    mask.paste(edge, (right - CELL + 1, top))
    img.paste(win, (0, 0), mask)

    bar_h = 60
    bar = ImageDraw.Draw(img)
    for x in range(left + 2, right - 1):
        t = 1 - (x - left) / (right - left)
        bar.line([(x, top + 2), (x, top + bar_h)], fill=over(ACC, 0.15 * t, PANEL))
    bar.rectangle([left + 2, top + bar_h, right - 2, top + bar_h + 1], fill=LINE)
    date = meta["pubDate"]
    label = f"{date:%Y·%m·%d} · {minutes} MIN"
    spaced(img, (left + 30, top + 18), label, small, ACC, 3)

    inner = right - left - 60
    for size in TITLE_SIZES:
        font = base.load("DepartureMono-Regular.woff2", size)
        lines = wrap(meta["title"], font, inner)
        if lines and len(lines) <= 3:
            break
    y = top + bar_h + 44
    for line in lines:
        base.crisp(img, (left + 30, y), line, font, INK)
        y += round(size * 1.15)

    x, y = left + 30, y + 26
    d = ImageDraw.Draw(img)
    for tag in meta.get("tags") or []:
        text = f"#{tag}"
        tw = round(small.getlength(text))
        d.rounded_rectangle([x, y, x + tw + 32, y + 44], radius=6, fill=EDGE)
        d.rounded_rectangle([x + 2, y + 2, x + tw + 30, y + 42], radius=5, fill=CODE)
        base.crisp(img, (x + 16, y + 10), text, small, ACC)
        x += tw + 32 + 14

    mark_px = 64
    word = base.load("DepartureMono-Regular.woff2", 33)
    wtxt = "duplexsystem.org"
    ww = round(word.getlength(wtxt))
    wx = W - M - 30 - ww
    wy = H - M - 30
    _, t, _, b = word.getbbox(wtxt)
    mark = base.draw_mark(mark_px)
    _, mt, _, mb = mark.getbbox()
    my = round(wy + (t + b) / 2 - (mt + mb) / 2)
    img.paste(ACC, (wx - mark_px - 18, my), mark)
    base.crisp(img, (wx, wy), wtxt, word, ACC)
    return img


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    posts = {}
    for path in sorted(POSTS.glob("*.md*")):
        meta, body = front_matter(path.read_text())
        if meta.get("draft") and not os.environ.get("INCLUDE_DRAFTS"):
            continue
        if meta.get("title") and meta.get("pubDate"):
            posts[path.stem] = (meta, body)
    minutes = read_minutes({k: body for k, (_, body) in posts.items()})
    keep = {f"{k}.png" for k in posts}
    for stale in OUT_DIR.glob("*.png"):
        if stale.name not in keep:
            stale.unlink()
    for slug, (meta, _) in posts.items():
        out = OUT_DIR / f"{slug}.png"
        img = card(meta, minutes[slug])
        buf = io.BytesIO()
        img.save(buf, format="PNG", optimize=True)
        if not out.exists() or out.read_bytes() != buf.getvalue():
            out.write_bytes(buf.getvalue())
    print(f"post cards: {len(posts)} in {OUT_DIR.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
