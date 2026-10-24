#!/usr/bin/env python3

import hashlib
import json
import pathlib
import re
import sys

import fontTools
from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "src/assets/fonts/source"
OUT = ROOT / "src/assets/fonts/generated"
SCAN_DIRS = [ROOT / "src"]

RANGES = (
    "U+0020-007E,U+00A0-00FF,U+2000-206F,U+2122,U+2190-2193,U+2212,"
    "U+0100-017F,U+2070-209F,U+20A0-20BF,U+2500-257F,U+25A0-25FF"
)
ASCII = "U+0020-007E"
LOCK = ROOT / "src/assets/fonts/chars.json"
KATEX = ROOT / "node_modules/katex/dist"
TOKENS_CSS = ROOT / "src/styles/tokens.css"

def _parse_unicodes(spec: str) -> set[int]:
    out: set[int] = set()
    for part in spec.split(","):
        part = part.strip().removeprefix("U+")
        if "-" in part:
            lo, hi = part.split("-")
            out.update(range(int(lo, 16), int(hi, 16) + 1))
        else:
            out.add(int(part, 16))
    return out


def to_ranges(codes: set[int]) -> str:
    out, run = [], []
    for c in sorted(codes):
        if run and c == run[-1] + 1:
            run.append(c)
            continue
        if run:
            out.append(f"U+{run[0]:04X}" + (f"-{run[-1]:04X}" if len(run) > 1 else ""))
        run = [c]
    if run:
        out.append(f"U+{run[0]:04X}" + (f"-{run[-1]:04X}" if len(run) > 1 else ""))
    return ",".join(out)


def split_ranges(lock: dict[str, str], stem: str) -> tuple[str, str]:
    all_ = _parse_unicodes(RANGES)
    core = {ord(c) for c in lock[stem]} if stem in lock else _parse_unicodes(ASCII)
    core &= all_
    return to_ranges(core), to_ranges(all_ - core)


MANDATORY_WEIGHTS = {400, 700}
WEIGHT_KEYWORDS = {"normal": 400, "bold": 700}
AXIS_SCAN_EXTS = {".css", ".astro"}

_WEIGHT_RE = re.compile(r"font-weight\s*:\s*([A-Za-z0-9]+)")
_VARSET_RE = re.compile(r"font-variation-settings\s*:\s*([^;}]+)")
_AXIS_RE = re.compile(r"""['"](\w{4})['"]\s*([0-9.]+)""")
_STYLE_BLOCK_RE = re.compile(r"<style[^>]*>(.*?)</style>", re.S | re.I)
_STYLE_ATTR_RE = re.compile(r"""(?<![\w-])style\s*=\s*(?:"([^"]*)"|'([^']*)')""", re.I)
_RULE_RE = re.compile(r"([^{}]+)\{([^}]*)\}", re.S)
_FAMILY_RE = re.compile(r"--font-(\w+)")

FAMILIES = ("literata", "departure", "jetbrains")


def declaration_bodies(path: pathlib.Path, text: str) -> list[str]:
    if path.suffix == ".css":
        css = text
        attrs: list[str] = []
    else:
        css = "\n".join(_STYLE_BLOCK_RE.findall(text))
        attrs = [a or b for a, b in _STYLE_ATTR_RE.findall(text)]
    return [body for _, body in _RULE_RE.findall(css)] + attrs


def scan_axis_usage_per_family(
    scan_dirs: list[pathlib.Path] | None = None,
) -> dict[str, dict[str, set]]:
    per = {k: {"weights": set(MANDATORY_WEIGHTS), "opsz": set()} for k in FAMILIES}
    for d in SCAN_DIRS if scan_dirs is None else scan_dirs:
        for p in d.rglob("*"):
            if not (p.is_file() and p.suffix in AXIS_SCAN_EXTS):
                continue
            text = p.read_text(encoding="utf-8", errors="ignore")
            for body in declaration_bodies(p, text):
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


def scan_axis_usage(
    scan_dirs: list[pathlib.Path] | None = None,
) -> tuple[set[int], set[float]]:
    per = scan_axis_usage_per_family(scan_dirs)
    return (
        set().union(*(f["weights"] for f in per.values())),
        set().union(*(f["opsz"] for f in per.values())),
    )


def axis_spec(src: pathlib.Path, weights: set[int], opsz: set[float]) -> dict:
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


LOCKED: dict[str, str] = {}
SPLITS: dict[str, dict[str, str]] = {}


def run_split(src: pathlib.Path, stem: str) -> None:
    core, ext = split_ranges(LOCKED, stem)
    SPLITS[stem] = {"core": core, "ext": ext}
    run_subset(src, OUT / f"{stem}-core.woff2", f"--unicodes={core}")
    run_subset(src, OUT / f"{stem}-ext.woff2", f"--unicodes={ext}")


def run_static_subsets(
    src: pathlib.Path, stem: str, weights: set[int], opsz: set[float]
) -> None:
    for w in sorted(weights):
        spec = {**axis_spec(src, {w}, opsz), "wght": w}
        font = TTFont(src)
        font.recalcTimestamp = False
        instancer.instantiateVariableFont(font, spec, inplace=True, updateFontNames=False)
        tmp = OUT / f"{stem}-{w}.instanced.ttf"
        font.save(tmp)
        try:
            run_split(tmp, f"{stem}-{w}")
        finally:
            tmp.unlink(missing_ok=True)


def run_subset(src: pathlib.Path, dst: pathlib.Path, *extra: str) -> None:
    args = [
        str(src),
        f"--output-file={dst}",
        "--flavor=woff2",
        "--layout-features+=calt,liga,kern",
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


STAMP = OUT / ".inputs"
MANIFEST = OUT / "fonts.json"


def outputs(lit_weights: set[int], lock: dict[str, str] | None = None) -> list[str]:
    stems = [
        f"literata-{style}-{w}" for style in ("roman", "italic") for w in sorted(lit_weights)
    ] + ["jetbrains-mono", "jetbrains-mono-italic", "jetbrains-mono-bold", "departure-mono"]
    katex = [f"katex/{k}.woff2" for k in sorted(lock or {}) if k.startswith("KaTeX_")]
    return [f"{stem}-{part}.woff2" for stem in stems for part in ("core", "ext")] + [
        "noto-emoji.woff2",
        MANIFEST.name,
        *katex,
    ]


def cmap_of(path: pathlib.Path) -> set[int]:
    font = TTFont(path)
    try:
        return set(font.getBestCmap())
    finally:
        font.close()


def emoji_range() -> set[int]:
    css = TOKENS_CSS.read_text(encoding="utf-8")
    face = re.search(r"@font-face\s*\{[^}]*'Noto Emoji'[^}]*\}", css)
    rng = re.search(r"unicode-range:\s*([^;]+);", face.group(0)) if face else None
    if not rng:
        sys.exit("FAIL: no unicode-range on the Noto Emoji @font-face in tokens.css")
    return _parse_unicodes(rng.group(1).replace(" ", "").replace("\n", ""))


def katex_faces() -> list[dict]:
    css = (KATEX / "katex.min.css").read_text(encoding="utf-8")
    out = []
    for body in re.findall(r"@font-face\{([^}]*)\}", css):
        family = re.search(r"font-family:\s*([^;]+)", body).group(1).strip().strip("\"'")
        style = re.search(r"font-style:\s*([^;]+)", body).group(1).strip()
        weight = re.search(r"font-weight:\s*([^;]+)", body).group(1).strip()
        stem = re.search(r"url\(fonts/([^)]+)\.woff2\)", body).group(1)
        out.append(
            {
                "key": stem,
                "family": family,
                "style": "italic" if style == "italic" else "normal",
                "weight": 700 if weight in ("bold", "700") else 400,
                "covers": to_ranges(cmap_of(KATEX / "fonts" / f"{stem}.ttf")),
            }
        )
    return out


def faces(lit_weights: set[int]) -> list[dict]:
    text = _parse_unicodes(RANGES)
    out = []

    def face(key, family, style, weight, src, declared=None):
        cover = cmap_of(src)
        if declared is not None:
            cover &= declared
        out.append(
            {"key": key, "family": family, "style": style, "weight": weight, "covers": to_ranges(cover)}
        )

    for w in sorted(lit_weights):
        face(f"literata-roman-{w}", "Literata", "normal", w, SRC / "Literata-roman.ttf", text)
        face(f"literata-italic-{w}", "Literata", "italic", w, SRC / "Literata-italic.ttf", text)
    face("jetbrains-mono", "JetBrains Mono", "normal", 400, SRC / "JetBrainsMono-Regular.ttf", text)
    face("jetbrains-mono-italic", "JetBrains Mono", "italic", 400, SRC / "JetBrainsMono-Italic.ttf", text)
    face("jetbrains-mono-bold", "JetBrains Mono", "normal", 700, SRC / "JetBrainsMono-Bold.ttf", text)
    face("departure-mono", "Departure Mono", "normal", 400, SRC / "DepartureMono-Regular.woff2", text)
    face("noto-emoji", "Noto Emoji", "normal", 400, SRC / "Noto-COLRv1.ttf", emoji_range())
    return out + katex_faces()


def fingerprint(per_family: dict, lock: str = "") -> str:
    h = hashlib.sha256()
    h.update(pathlib.Path(__file__).read_bytes())
    h.update(fontTools.version.encode())
    for src in [*sorted(SRC.iterdir()), KATEX / "katex.min.css", TOKENS_CSS]:
        if src.is_file():
            h.update(src.name.encode() + b"\0" + src.read_bytes())
    h.update(
        repr(
            (
                sorted(
                    (f, sorted(v["weights"]), sorted(v["opsz"]))
                    for f, v in per_family.items()
                ),
                lock,
            )
        ).encode()
    )
    return h.hexdigest()


FULL = OUT / "full"


def main_full() -> int:
    per_family = scan_axis_usage_per_family()
    lit_weights, lit_opsz = (
        per_family["literata"]["weights"],
        per_family["literata"]["opsz"],
    )
    stamp = FULL / ".inputs"
    want = fingerprint(per_family)
    names = [
        *(f"literata-{style}-{w}.woff2" for style in ("roman", "italic") for w in sorted(lit_weights)),
        "jetbrains-mono.woff2",
        "jetbrains-mono-italic.woff2",
        "jetbrains-mono-bold.woff2",
        "departure-mono.woff2",
        "noto-emoji.woff2",
        "fonts.json",
    ]
    if (
        "--force" not in sys.argv
        and stamp.exists()
        and stamp.read_text() == want
        and all((FULL / n).exists() for n in names)
    ):
        print("full fonts up to date (inputs unchanged), use --force to regenerate")
        return 0
    FULL.mkdir(parents=True, exist_ok=True)
    stamp.unlink(missing_ok=True)
    for old in FULL.glob("*.woff2"):
        if old.name not in names:
            old.unlink()
    print("full fonts, for draft builds:")
    whole = ("--unicodes=*", "--layout-features=*")
    for style in ("roman", "italic"):
        src = SRC / f"Literata-{style}.ttf"
        for w in sorted(lit_weights):
            font = TTFont(src)
            font.recalcTimestamp = False
            spec = {**axis_spec(src, {w}, lit_opsz), "wght": w}
            instancer.instantiateVariableFont(font, spec, inplace=True, updateFontNames=False)
            tmp = FULL / f"literata-{style}-{w}.instanced.ttf"
            font.save(tmp)
            try:
                run_subset(tmp, FULL / f"literata-{style}-{w}.woff2", *whole)
            finally:
                tmp.unlink(missing_ok=True)
    for src, stem in (
        ("JetBrainsMono-Regular.ttf", "jetbrains-mono"),
        ("JetBrainsMono-Italic.ttf", "jetbrains-mono-italic"),
        ("JetBrainsMono-Bold.ttf", "jetbrains-mono-bold"),
        ("DepartureMono-Regular.woff2", "departure-mono"),
        ("Noto-COLRv1.ttf", "noto-emoji"),
    ):
        run_subset(SRC / src, FULL / f"{stem}.woff2", *whole)
    (FULL / "fonts.json").write_text(json.dumps({"weights": sorted(lit_weights)}) + "\n")
    stamp.write_text(want)
    return 0


def main() -> int:
    if "--full" in sys.argv:
        return main_full()
    per_family = scan_axis_usage_per_family()
    lock_text = LOCK.read_text(encoding="utf-8") if LOCK.exists() else "{}"
    LOCKED.update(json.loads(lock_text))
    want = fingerprint(per_family, lock_text)
    if (
        "--force" not in sys.argv
        and STAMP.exists()
        and STAMP.read_text() == want
        and all(
            (OUT / name).exists()
            for name in outputs(per_family["literata"]["weights"], LOCKED)
        )
    ):
        print("fonts up to date (inputs unchanged), use --force to regenerate")
        unstage_emoji()
        return 0

    OUT.mkdir(parents=True, exist_ok=True)
    STAMP.unlink(missing_ok=True)
    print("subsetting fonts:")
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
    keep = set(outputs(lit_weights, LOCKED))
    for old in [*OUT.glob("*.woff2"), *OUT.glob("katex/*.woff2")]:
        if str(old.relative_to(OUT)) not in keep:
            old.unlink()

    run_static_subsets(SRC / "Literata-roman.ttf", "literata-roman", lit_weights, lit_opsz)
    run_static_subsets(SRC / "Literata-italic.ttf", "literata-italic", lit_weights, lit_opsz)
    run_split(SRC / "JetBrainsMono-Regular.ttf", "jetbrains-mono")
    run_split(SRC / "JetBrainsMono-Italic.ttf", "jetbrains-mono-italic")
    run_split(SRC / "JetBrainsMono-Bold.ttf", "jetbrains-mono-bold")
    run_split(SRC / "DepartureMono-Regular.woff2", "departure-mono")

    emoji = LOCKED.get("noto-emoji", "")
    run_subset(
        SRC / "Noto-COLRv1.ttf",
        OUT / "noto-emoji.woff2",
        f"--unicodes={to_ranges({ord(c) for c in emoji})}",
    )
    (OUT / "katex").mkdir(exist_ok=True)
    for key, chars in sorted(LOCKED.items()):
        if key.startswith("KaTeX_"):
            run_subset(
                KATEX / "fonts" / f"{key}.ttf",
                OUT / "katex" / f"{key}.woff2",
                f"--unicodes={to_ranges({ord(c) for c in chars})}",
            )

    MANIFEST.write_text(
        json.dumps(
            {
                "weights": sorted(lit_weights),
                "all": RANGES,
                "files": SPLITS,
                "faces": faces(lit_weights),
            }
        )
        + "\n"
    )
    unstage_emoji()
    STAMP.write_text(want)
    return 0


def unstage_emoji() -> None:
    public_fonts = ROOT / "public/fonts"
    (public_fonts / "noto-emoji.woff2").unlink(missing_ok=True)
    try:
        public_fonts.rmdir()
    except OSError:
        pass


if __name__ == "__main__":
    sys.exit(main())
