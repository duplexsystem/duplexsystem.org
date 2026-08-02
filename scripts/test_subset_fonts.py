import subprocess, sys, pathlib, tempfile

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from subset_fonts import (
    scan_emoji,
    scan_axis_usage,
    axis_spec,
    MANDATORY_WEIGHTS,
    SRC,
    _parse_unicodes,
)


def test_finds_basic_emoji():
    assert 0x1F980 in scan_emoji("a crab 🦀 here")


def test_bare_text_arrow_is_not_emoji():
    # U+2192 is already covered by the LATIN text subset. Without a following
    # U+FE0F presentation selector it must not drag in the emoji face.
    assert scan_emoji("all posts →") == set()


def test_text_arrow_with_presentation_selector_is_emoji():
    assert 0x2192 in scan_emoji("→️")


def test_real_emoji_outside_text_range_is_still_found():
    assert 0x1F980 in scan_emoji("🦀")


def test_parse_unicodes_expands_range():
    assert _parse_unicodes("U+0041-0043") == {0x41, 0x42, 0x43}


def test_finds_emoji_with_variation_selector():
    found = scan_emoji("desktop 🖥️")
    assert 0x1F5A5 in found and 0xFE0F in found


def test_ignores_plain_ascii():
    assert scan_emoji("no emoji at all, just ascii") == set()


def test_includes_zwj_for_sequences():
    assert 0x200D in scan_emoji("family 👨‍👩‍👧")


def test_finds_misc_technical_block():
    assert 0x231A in scan_emoji("⌚")
    assert 0x23F0 in scan_emoji("⏰")


def _fixture_dir(files: dict[str, str]) -> pathlib.Path:
    """Write `files` (name -> content) into a fresh temp dir and return it."""
    tmp = pathlib.Path(tempfile.mkdtemp())
    for name, content in files.items():
        (tmp / name).write_text(content, encoding="utf-8")
    return tmp


def test_scan_axis_usage_finds_numeric_weight():
    d = _fixture_dir({"a.css": "h1 { font-weight: 600; }"})
    weights, opsz = scan_axis_usage([d])
    assert 600 in weights


def test_scan_axis_usage_maps_bold_and_normal_keywords():
    d = _fixture_dir({"a.css": "b { font-weight: bold; } i { font-weight: normal; }"})
    weights, opsz = scan_axis_usage([d])
    assert 700 in weights and 400 in weights


def test_scan_axis_usage_extracts_variation_settings():
    d = _fixture_dir(
        {"a.css": "h1 { font-variation-settings: 'opsz' 36, 'wght' 550; }"}
    )
    weights, opsz = scan_axis_usage([d])
    assert 550 in weights
    assert 36.0 in opsz


def test_scan_axis_usage_mandatory_weights_present_when_source_declares_none():
    d = _fixture_dir({"a.css": "p { color: red; }"})
    weights, opsz = scan_axis_usage([d])
    assert weights == MANDATORY_WEIGHTS
    assert opsz == set()


def test_axis_spec_pins_axis_for_single_value():
    spec = axis_spec(SRC / "Literata-roman.ttf", {400}, set())
    assert spec["wght"] == 400


def test_axis_spec_clamps_axis_for_multiple_values():
    spec = axis_spec(SRC / "Literata-roman.ttf", {400, 700}, set())
    assert spec["wght"] == (400, 700)


def test_axis_spec_leaves_opsz_when_none_found():
    spec = axis_spec(SRC / "Literata-roman.ttf", {400}, set())
    assert "opsz" not in spec


def test_axis_spec_rejects_unsupported_weight():
    try:
        axis_spec(SRC / "Literata-roman.ttf", {400, 700, 1000}, set())
    except SystemExit as exc:
        assert "1000" in str(exc)
    else:
        raise AssertionError("expected SystemExit for an out-of-range weight")


def test_scan_axis_usage_ignores_markdown_prose():
    # A blog post *writing about* a weight must not widen the shipped axis.
    d = _fixture_dir(
        {"post.md": "You can write `font-weight: 950` to get an extra-bold look."}
    )
    weights, opsz = scan_axis_usage([d])
    assert weights == MANDATORY_WEIGHTS


def test_scan_axis_usage_picks_up_style_block_in_astro():
    d = _fixture_dir(
        {"a.astro": "<style>\nh1 { font-weight: 600; }\n</style>\n<h1>Hi</h1>"}
    )
    weights, opsz = scan_axis_usage([d])
    assert 600 in weights


def test_scan_axis_usage_ignores_astro_prose_outside_style_block():
    # This is the actual regression: prose in an .astro template that merely
    # mentions a weight must not be mistaken for a real declaration.
    d = _fixture_dir({"a.astro": "<p>Try font-weight: 950 in your CSS.</p>"})
    weights, opsz = scan_axis_usage([d])
    assert 950 not in weights
    assert weights == MANDATORY_WEIGHTS


def test_scan_axis_usage_picks_up_inline_style_attribute():
    d = _fixture_dir({"a.astro": '<h1 style="font-weight: 800">Hi</h1>'})
    weights, opsz = scan_axis_usage([d])
    assert 800 in weights


def test_scan_axis_usage_scans_css_file_in_full():
    # .css files have no <style> wrapper to filter through; the whole file
    # is CSS, unlike .astro where only style blocks/attributes count.
    d = _fixture_dir({"a.css": "/* heading */\nh1 { font-weight: 500; }"})
    weights, opsz = scan_axis_usage([d])
    assert 500 in weights


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_"):
            fn()
            print(f"ok {name}")
