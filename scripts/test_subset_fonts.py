import subprocess, sys, pathlib, tempfile

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from subset_fonts import (
    scan_axis_usage,
    scan_axis_usage_per_family,
    axis_spec,
    MANDATORY_WEIGHTS,
    SRC,
    _parse_unicodes,
    fingerprint,
)


def test_parse_unicodes_expands_range():
    assert _parse_unicodes("U+0041-0043") == {0x41, 0x42, 0x43}


def _fixture_dir(files: dict[str, str]) -> pathlib.Path:
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
    d = _fixture_dir({"a.astro": "<p>Try font-weight: 950 in your CSS.</p>"})
    weights, opsz = scan_axis_usage([d])
    assert 950 not in weights
    assert weights == MANDATORY_WEIGHTS


def test_scan_axis_usage_picks_up_inline_style_attribute():
    d = _fixture_dir({"a.astro": '<h1 style="font-weight: 800">Hi</h1>'})
    weights, opsz = scan_axis_usage([d])
    assert 800 in weights


def test_scan_axis_usage_scans_css_file_in_full():
    d = _fixture_dir({"a.css": "/* heading */\nh1 { font-weight: 500; }"})
    weights, opsz = scan_axis_usage([d])
    assert 500 in weights


def test_inline_style_survives_a_quoted_family_before_the_weight():
    d = _fixture_dir(
        {"a.astro": """<h1 style="font-family: 'Departure'; font-weight: 800">Hi</h1>"""}
    )
    assert 800 in scan_axis_usage([d])[0]
    d = _fixture_dir(
        {"a.astro": """<h1 style='font-family: "X"; font-weight: 300'>Hi</h1>"""}
    )
    assert 300 in scan_axis_usage([d])[0]


def test_data_style_attribute_is_not_css():
    d = _fixture_dir({"a.astro": '<p data-style="font-weight: 100">Hi</p>'})
    assert 100 not in scan_axis_usage([d])[0]


def test_fingerprint_follows_every_input_the_output_depends_on():
    base = {
        f: {"weights": {400, 700}, "opsz": set()}
        for f in ("literata", "departure", "jetbrains")
    }
    same = fingerprint(base, '{"noto-emoji": "a"}')
    assert fingerprint(base, '{"noto-emoji": "a"}') == same
    assert fingerprint(base, '{"noto-emoji": "b"}') != same
    wider = {**base, "literata": {"weights": {400, 600, 700}, "opsz": set()}}
    assert fingerprint(wider, '{"noto-emoji": "a"}') != same
    with_opsz = {**base, "literata": {"weights": {400, 700}, "opsz": {14.0}}}
    assert fingerprint(with_opsz, '{"noto-emoji": "a"}') != same


def test_check_ligatures_sees_whether_calt_survives_subsetting():
    from fontTools import subset
    import check_ligatures

    out = pathlib.Path(tempfile.mkdtemp())
    for tag, features in (("kept", "calt"), ("lost", "kern")):
        subset.main(
            [
                str(SRC / "JetBrainsMono-Regular.ttf"),
                f"--output-file={out / tag}.ttf",
                "--unicodes=U+0020-007E",
                f"--layout-features={features}",
            ]
        )
    assert "calt" in check_ligatures.features(out / "kept.ttf")
    assert "calt" not in check_ligatures.features(out / "lost.ttf")


def test_per_family_scan_picks_up_inline_style_attribute(monkeypatch=None):
    import subset_fonts

    d = _fixture_dir({"a.astro": '<h1 style="font-weight: 800">Hi</h1>'})
    old = subset_fonts.SCAN_DIRS
    subset_fonts.SCAN_DIRS = [d]
    try:
        per = scan_axis_usage_per_family()
    finally:
        subset_fonts.SCAN_DIRS = old
    assert 800 in per["literata"]["weights"]


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_"):
            fn()
            print(f"ok {name}")
