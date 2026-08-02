#!/usr/bin/env python3
"""Write rehype/math-names.json: every character KaTeX can draw, by Unicode name.

The character set is taken from the cmaps of KaTeX's own fonts, so it covers
exactly what the renderer can produce and needs no hand-maintained list. The
rehype plugin uses it to make an expression findable by the words for its
symbols, the way emoji are findable by theirs.
"""

import json
import pathlib
import unicodedata

from fontTools.ttLib import TTFont

ROOT = pathlib.Path(__file__).resolve().parent.parent
FONTS = ROOT / "node_modules/katex/dist/fonts"
OUT = ROOT / "rehype/math-names.json"

# Plain ASCII carries no useful search term: nobody looks for "latin small
# letter a", and the letters are already indexed as the text they render to.
SKIP = set(range(0x00, 0x80))


def main() -> None:
    if not FONTS.is_dir():
        raise SystemExit(f"{FONTS} not found, run npm install first")

    names: dict[str, str] = {}
    for path in sorted(FONTS.glob("*.woff2")):
        for code in TTFont(path).getBestCmap():
            if code in SKIP:
                continue
            char = chr(code)
            if char in names:
                continue
            try:
                names[char] = unicodedata.name(char).lower()
            except ValueError:
                pass

    OUT.write_text(
        json.dumps(dict(sorted(names.items())), ensure_ascii=False, indent=0) + "\n"
    )
    print(f"math names: {len(names)} symbol(s) -> {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
