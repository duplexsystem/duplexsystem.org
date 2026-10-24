#!/usr/bin/env python3

import json
import pathlib

from fontTools.misc.roundTools import otRound
from fontTools.ttLib import TTFont

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "src/assets/fonts/source/Literata-roman.ttf"
OUT = ROOT / "rehype/punct-widths.json"

MARKS = ".,;:!?)]}'\"’”…"


def main() -> None:
    font = TTFont(SRC)
    glyphs = font.getGlyphSet(location={"wght": 400, "opsz": 14})
    cmap = font.getBestCmap()
    upm = font["head"].unitsPerEm
    widths = {
        ch: round(otRound(glyphs[cmap[ord(ch)]].width) / upm, 4)
        for ch in MARKS
        if ord(ch) in cmap
    }
    text = json.dumps(widths, ensure_ascii=False, indent=2) + "\n"
    if not OUT.exists() or OUT.read_text() != text:
        OUT.write_text(text)
    print(f"  {OUT.name}: {len(widths)} marks")


if __name__ == "__main__":
    main()
