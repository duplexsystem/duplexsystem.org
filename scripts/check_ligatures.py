#!/usr/bin/env python3

import pathlib
import sys

from fontTools.ttLib import TTFont

OUT = pathlib.Path(__file__).resolve().parent.parent / "src/assets/fonts/generated"
REQUIRED = {"calt"}

TARGETS = ["jetbrains-mono-core.woff2", "jetbrains-mono-bold-core.woff2"]


def features(path: pathlib.Path) -> set[str]:
    font = TTFont(path)
    if "GSUB" not in font:
        return set()
    return {
        r.FeatureTag
        for r in font["GSUB"].table.FeatureList.FeatureRecord
        if r.Feature.LookupListIndex
    }


def main() -> int:
    failed = False
    for name in TARGETS:
        target = OUT / name
        if not target.exists():
            print(f"FAIL: {target} missing, run subset_fonts.py first", file=sys.stderr)
            failed = True
            continue
        missing = REQUIRED - features(target)
        if missing:
            print(
                f"FAIL: {name} lost {sorted(missing)}. "
                f"Ligatures will silently not render.",
                file=sys.stderr,
            )
            failed = True
        else:
            print(f"ok: {name} retains {sorted(REQUIRED)}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
