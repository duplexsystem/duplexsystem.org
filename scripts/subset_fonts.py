#!/usr/bin/env python3
"""Subset the four self-hosted faces. Run as a prebuild step."""

import pathlib, re, shutil, sys
from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "src/assets/fonts/source"
OUT = ROOT / "src/assets/fonts/generated"
SCAN_DIRS = [ROOT / "src"]
SCAN_EXTS = {".md", ".mdx", ".astro", ".ts", ".yaml", ".yml"}

LATIN = (
    "U+0020-007E,U+00A0-00FF,U+0100-017F,U+2000-206F,"
    "U+2070-209F,U+20A0-20BF,U+2122,U+2190-2193,U+2500-257F,U+25A0-25FF"
)

JETBRAINS_EXTRA = "U+2212"

EMOJI_RANGES = [
    (0x1F300, 0x1FAFF),  # Misc Symbols and Pictographs .. Symbols and Pictographs Ext-A
    (0x1F000, 0x1F2FF),  # Mahjong, Dominoes, Playing Cards, Enclosed Alphanumeric Supp
    (0x2600, 0x27BF),  # Misc Symbols, Dingbats
    (0x2300, 0x23FF),  # Misc Technical: watch, hourglass, keyboard, timers, media
    (0x2900, 0x297F),  # Supplemental Arrows-B: curved arrows
    (0x2B00, 0x2BFF),  # Misc Symbols and Arrows
    (0x2190, 0x21FF),  # Arrows
    (0x20E3, 0x20E3),  # Combining enclosing keycap, required for 1..9 keycaps
    (0x3030, 0x3030),  # Wavy dash
    (0x303D, 0x303D),  # Part alternation mark
    (0x3297, 0x3299),  # Circled ideographs
    (0xFE0F, 0xFE0F),  # Variation selector-16 (emoji presentation)
    (0x200D, 0x200D),  # Zero-width joiner (sequences)
    (0x1F1E6, 0x1F1FF),  # Regional indicators (flags)
    (0xE0020, 0xE007F),  # Tag characters (subdivision flags)
]


def _parse_unicodes(spec: str) -> set[int]:
    """Expand a pyftsubset --unicodes spec into a set of codepoints."""
    out: set[int] = set()
    for part in spec.split(","):
        part = part.strip().removeprefix("U+")
        if "-" in part:
            lo, hi = part.split("-")
            out.update(range(int(lo, 16), int(hi, 16) + 1))
        else:
            out.add(int(part, 16))
    return out


TEXT_COVERED = _parse_unicodes(LATIN)

FORMAT_CHARS = {0x200D}


def scan_emoji(text: str) -> set[int]:
    """Emoji-relevant codepoints in `text`.

    Codepoints the text fonts already cover count as emoji only when a U+FE0F
    selector follows; a bare arrow would otherwise drag in the whole color
    face. FORMAT_CHARS are exempt.
    """
    found: set[int] = set()
    chars = list(text)
    for i, ch in enumerate(chars):
        cp = ord(ch)
        if not any(lo <= cp <= hi for lo, hi in EMOJI_RANGES):
            continue
        if (
            cp in TEXT_COVERED
            and cp not in FORMAT_CHARS
            and not (i + 1 < len(chars) and ord(chars[i + 1]) == 0xFE0F)
        ):
            continue
        found.add(cp)
    return found


INCLUDE_DRAFTS = "--include-drafts" in sys.argv

CONTENT_EXTS = {".md", ".mdx"}
_FRONTMATTER_RE = re.compile(r"\A---\r?\n(.*?)\r?\n---", re.S)
_DRAFT_RE = re.compile(r"^draft:\s*true\s*$", re.M)


def is_draft(path: pathlib.Path, text: str) -> bool:
    """True for a content file whose YAML frontmatter sets `draft: true`.

    Anchored to the frontmatter block: a post writing about `draft: true` in
    prose is not a draft.
    """
    if path.suffix not in CONTENT_EXTS:
        return False
    m = _FRONTMATTER_RE.match(text)
    return bool(m and _DRAFT_RE.search(m.group(1)))


def scan_sources() -> set[int]:
    found = set()
    skipped = []
    for d in SCAN_DIRS:
        for p in d.rglob("*"):
            if p.is_file() and p.suffix in SCAN_EXTS:
                text = p.read_text(encoding="utf-8", errors="ignore")
                if not INCLUDE_DRAFTS and is_draft(p, text):
                    skipped.append(p.name)
                    continue
                found |= scan_emoji(text)
    if skipped:
        print(
            f"  skipped {len(skipped)} draft post(s) for emoji scan "
            f"({', '.join(sorted(skipped))}), use --include-drafts to include them"
        )
    return found


MANDATORY_WEIGHTS = {400, 700}
WEIGHT_KEYWORDS = {"normal": 400, "bold": 700}
AXIS_SCAN_EXTS = {".css", ".astro"}

_WEIGHT_RE = re.compile(r"font-weight\s*:\s*([A-Za-z0-9]+)")
_VARSET_RE = re.compile(r"font-variation-settings\s*:\s*([^;}]+)")
_AXIS_RE = re.compile(r"""['"](\w{4})['"]\s*([0-9.]+)""")
_STYLE_BLOCK_RE = re.compile(r"<style[^>]*>(.*?)</style>", re.S | re.I)
_STYLE_ATTR_RE = re.compile(r"""style\s*=\s*["']([^"']*)["']""", re.I)


def css_text(path: pathlib.Path, text: str) -> str:
    """Return only the CSS within a file, never its prose.

    A post writing about `font-weight: 950` must not widen the shipped axis.
    What markdown genuinely produces is covered by MANDATORY_WEIGHTS.
    """
    if path.suffix == ".css":
        return text
    return "\n".join(_STYLE_BLOCK_RE.findall(text) + _STYLE_ATTR_RE.findall(text))


def scan_axis_usage(
    scan_dirs: list[pathlib.Path] = SCAN_DIRS,
) -> tuple[set[int], set[float]]:
    """Collect every font-weight and 'opsz' value the site actually asks for."""
    weights = set(MANDATORY_WEIGHTS)
    opsz: set[float] = set()
    for d in scan_dirs:
        for p in d.rglob("*"):
            if not (p.is_file() and p.suffix in AXIS_SCAN_EXTS):
                continue
            text = css_text(p, p.read_text(encoding="utf-8", errors="ignore"))
            for raw in _WEIGHT_RE.findall(text):
                low = raw.lower()
                if low in WEIGHT_KEYWORDS:
                    weights.add(WEIGHT_KEYWORDS[low])
                elif raw.isdigit():
                    weights.add(int(raw))
            for decl in _VARSET_RE.findall(text):
                for tag, value in _AXIS_RE.findall(decl):
                    if tag == "opsz":
                        opsz.add(float(value))
                    elif tag == "wght":
                        weights.add(int(float(value)))
    return weights, opsz


FAMILY_VARS = {
    "literata": ("Literata-roman.ttf", "Literata-italic.ttf"),
    "departure": ("DepartureMono-Regular.woff2",),
    "jetbrains": ("JetBrainsMono-Regular.ttf", "JetBrainsMono-Bold.ttf"),
}

_RULE_RE = re.compile(r"([^{}]+)\{([^}]*)\}", re.S)
_FAMILY_RE = re.compile(r"--font-(\w+)")


def scan_axis_usage_per_family() -> dict[str, dict[str, set]]:
    """Weights and optical sizes, attributed to the family each rule uses.

    A rule naming no family is credited to all of them: too wide an axis still
    renders correctly, too narrow renders a faux-bold.
    """
    per = {k: {"weights": set(MANDATORY_WEIGHTS), "opsz": set()} for k in FAMILY_VARS}
    for d in SCAN_DIRS:
        for p in d.rglob("*"):
            if not (p.is_file() and p.suffix in AXIS_SCAN_EXTS):
                continue
            text = css_text(p, p.read_text(encoding="utf-8", errors="ignore"))
            for sel, body in _RULE_RE.findall(text):
                fams = set(_FAMILY_RE.findall(body))
                targets = fams & per.keys() or per.keys()
                for raw in _WEIGHT_RE.findall(body):
                    low = raw.lower()
                    w = WEIGHT_KEYWORDS.get(low, int(raw) if raw.isdigit() else None)
                    if w is not None:
                        for t in targets:
                            per[t]["weights"].add(w)
                for decl in _VARSET_RE.findall(body):
                    for tag, value in _AXIS_RE.findall(decl):
                        for t in targets:
                            if tag == "opsz":
                                per[t]["opsz"].add(float(value))
                            elif tag == "wght":
                                per[t]["weights"].add(int(float(value)))
    return per


def axis_spec(src: pathlib.Path, weights: set[int], opsz: set[float]) -> dict:
    """Instancer spec for one variable font, clamped to its real axis limits.

    A single used value pins the axis (removing it); a range clamps it.
    """
    font = TTFont(src)
    limits = {a.axisTag: (a.minValue, a.maxValue) for a in font["fvar"].axes}
    font.close()

    spec: dict = {}

    if "wght" in limits:
        lo_a, hi_a = limits["wght"]
        outside = [w for w in sorted(weights) if not lo_a <= w <= hi_a]
        if outside:
            sys.exit(
                f"FAIL: {src.name} supports wght {lo_a:.0f}-{hi_a:.0f} but the site "
                f"requests {outside}. Either change the CSS or use a font that covers it."
            )
        lo, hi = min(weights), max(weights)
        spec["wght"] = lo if lo == hi else (lo, hi)

    if "opsz" in limits and opsz:
        lo_a, hi_a = limits["opsz"]
        lo = max(lo_a, min(opsz))
        hi = min(hi_a, max(opsz))
        spec["opsz"] = lo if lo == hi else (lo, hi)

    return spec


def run_variable_subset(
    src: pathlib.Path, dst: pathlib.Path, weights: set[int], opsz: set[float]
) -> None:
    """Instance unused axis ranges away, then unicode-subset the result."""
    spec = axis_spec(src, weights, opsz)
    font = TTFont(src)
    font.recalcTimestamp = False
    instancer.instantiateVariableFont(font, spec, inplace=True, updateFontNames=False)
    tmp = dst.parent / f"{dst.stem}.instanced.ttf"
    font.save(tmp)
    try:
        run_subset(tmp, dst, f"--unicodes={LATIN}")
    finally:
        tmp.unlink(missing_ok=True)
    rendered = {
        k: (v if not isinstance(v, tuple) else f"{v[0]:g}-{v[1]:g}")
        for k, v in spec.items()
    }
    print(f"      axes pinned/clamped: {rendered}")


def run_subset(src: pathlib.Path, dst: pathlib.Path, *extra: str) -> None:
    args = [
        str(src),
        f"--output-file={dst}",
        "--flavor=woff2",
        "--layout-features+=calt,liga,kern",  # never drop these
        "--no-hinting",
        "--desubroutinize",
        *extra,
    ]
    subset.main(args)
    if not dst.exists():
        sys.exit(
            f"FAIL: pyftsubset produced no output for {dst.name}. "
            f"Args: {' '.join(args[1:])}"
        )
    print(f"  {dst.name:28} {dst.stat().st_size / 1024:6.1f} kB")


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    print("subsetting fonts:")

    per_family = scan_axis_usage_per_family()
    for family in sorted(per_family):
        fw, fo = per_family[family]["weights"], per_family[family]["opsz"]
        print(
            f"  derived from source ({family}): wght={sorted(fw)} "
            f"opsz={sorted(fo) if fo else 'unset, axis kept for auto optical sizing'}"
        )

    lit_weights, lit_opsz = (
        per_family["literata"]["weights"],
        per_family["literata"]["opsz"],
    )
    run_variable_subset(
        SRC / "Literata-roman.ttf", OUT / "literata-roman.woff2", lit_weights, lit_opsz
    )
    run_variable_subset(
        SRC / "Literata-italic.ttf",
        OUT / "literata-italic.woff2",
        lit_weights,
        lit_opsz,
    )
    run_subset(
        SRC / "JetBrainsMono-Regular.ttf",
        OUT / "jetbrains-mono.woff2",
        f"--unicodes={LATIN},{JETBRAINS_EXTRA}",
    )
    run_subset(
        SRC / "JetBrainsMono-Bold.ttf",
        OUT / "jetbrains-mono-bold.woff2",
        f"--unicodes={LATIN},{JETBRAINS_EXTRA}",
    )

    shutil.copy(SRC / "DepartureMono-Regular.woff2", OUT / "departure-mono.woff2")
    print(
        f"  {'departure-mono.woff2':28} "
        f"{(OUT / 'departure-mono.woff2').stat().st_size / 1024:6.1f} kB (passthrough)"
    )

    used = scan_sources()
    if used:
        codes = ",".join(f"U+{c:04X}" for c in sorted(used))
        run_subset(
            SRC / "Noto-COLRv1.ttf", OUT / "noto-emoji.woff2", f"--unicodes={codes}"
        )
    else:
        target = OUT / "noto-emoji.woff2"
        target.unlink(missing_ok=True)
        print("  no emoji found in src/, skipping emoji subset")

    stage_emoji()
    return 0


def stage_emoji() -> None:
    """Copy the emoji subset to public/fonts/ under a stable, unhashed name.

    tokens.css references /fonts/noto-emoji.woff2 directly, since a static
    stylesheet cannot name a hashed URL. Staged here so the reference resolves
    as soon as the stylesheet exists.
    """
    emoji = OUT / "noto-emoji.woff2"
    public_fonts = ROOT / "public/fonts"
    if emoji.exists():
        public_fonts.mkdir(parents=True, exist_ok=True)
        shutil.copy(emoji, public_fonts / "noto-emoji.woff2")
        print(f"  staged {emoji.name} -> public/fonts/")
    else:
        (public_fonts / "noto-emoji.woff2").unlink(missing_ok=True)
        try:
            public_fonts.rmdir()
        except OSError:
            pass


if __name__ == "__main__":
    sys.exit(main())
