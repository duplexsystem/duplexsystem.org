#!/usr/bin/env python3

import json
import pathlib
import unicodedata

from fontTools.ttLib import TTFont

ROOT = pathlib.Path(__file__).resolve().parent.parent
FONTS = ROOT / "node_modules/katex/dist/fonts"
OUT = ROOT / "rehype/math-names.json"

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

    text = json.dumps(dict(sorted(names.items())), ensure_ascii=False, indent=0) + "\n"
    if not OUT.exists() or OUT.read_text() != text:
        OUT.write_text(text)
    print(f"math names: {len(names)} symbol(s) -> {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
