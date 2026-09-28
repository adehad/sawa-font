import json
import sys
from pathlib import Path

import pytest

from sawa_tools.checks import marks
from sawa_tools.cli import main

REPO_ROOT = Path(__file__).parents[2]
REAL_GROUPS = REPO_ROOT / "data" / "mark-groups.json"


def write_groups(path: Path, groups: list[dict]) -> Path:
    manifest_path = path / "mark-groups.json"
    manifest_path.write_text(json.dumps({"groups": groups}), encoding="utf-8")
    return manifest_path


def test_parse_single_codepoint() -> None:
    assert list(marks._parse_codepoints("U+064B")) == [0x064B]


def test_parse_range() -> None:
    assert list(marks._parse_codepoints("U+064E..U+0650")) == [0x064E, 0x064F, 0x0650]


def test_invalid_codepoint_format_is_rejected() -> None:
    with pytest.raises(marks.MarksError, match="invalid codepoint"):
        list(marks._parse_codepoints("064B"))


def test_reversed_range_is_rejected() -> None:
    with pytest.raises(marks.MarksError, match="start after end"):
        list(marks._parse_codepoints("U+0650..U+064E"))


def test_load_groups_valid_manifest(tmp_path: Path) -> None:
    path = write_groups(
        tmp_path,
        [
            {"id": "short", "codepoints": ["U+064E..U+0650"]},
            {"id": "shadda", "codepoints": ["U+0651"]},
        ],
    )
    groups, errors = marks.load_groups(path)
    assert errors == []
    assert groups == {"short": {0x064E, 0x064F, 0x0650}, "shadda": {0x0651}}


def test_load_groups_reports_invalid_codepoint(tmp_path: Path) -> None:
    path = write_groups(tmp_path, [{"id": "bad", "codepoints": ["not-a-codepoint"]}])
    _groups, errors = marks.load_groups(path)
    assert any("invalid codepoint" in error for error in errors)


def test_load_groups_reports_codepoint_in_two_groups(tmp_path: Path) -> None:
    path = write_groups(
        tmp_path,
        [
            {"id": "a", "codepoints": ["U+0651"]},
            {"id": "b", "codepoints": ["U+0651"]},
        ],
    )
    _groups, errors = marks.load_groups(path)
    assert any(
        "U+0651" in error and "'a'" in error and "'b'" in error for error in errors
    )


def test_load_groups_missing_file_raises(tmp_path: Path) -> None:
    with pytest.raises(marks.MarksError, match="cannot read"):
        marks.load_groups(tmp_path / "does-not-exist.json")


def test_load_groups_invalid_json_raises(tmp_path: Path) -> None:
    path = tmp_path / "mark-groups.json"
    path.write_text("{not valid json", encoding="utf-8")
    with pytest.raises(marks.MarksError, match="invalid JSON"):
        marks.load_groups(path)


pytest.importorskip("fontTools")

from fontTools.fontBuilder import FontBuilder  # noqa: E402
from fontTools.pens.ttGlyphPen import TTGlyphPen  # noqa: E402


def _build_font_with_cmap(tmp_path: Path, codepoints: list[int]) -> Path:
    """Builds a tiny real TTF whose cmap covers `codepoints` (plus '.notdef')."""
    builder = FontBuilder(unitsPerEm=1000, isTTF=True)
    glyph_order = [".notdef"] + [f"g{cp:04x}" for cp in codepoints]
    builder.setupGlyphOrder(glyph_order)
    builder.setupCharacterMap(dict(zip(codepoints, glyph_order[1:], strict=True)))

    empty_glyph = TTGlyphPen(None).glyph()
    glyphs = {name: empty_glyph for name in glyph_order}
    builder.setupGlyf(glyphs)
    builder.setupHorizontalMetrics({name: (0, 0) for name in glyph_order})
    builder.setupHorizontalHeader(ascent=800, descent=-200)
    builder.setupNameTable({"familyName": "Test", "styleName": "Regular"})
    builder.setupOS2()
    builder.setupPost()

    font_path = tmp_path / "Test-Regular.ttf"
    builder.font.save(font_path)
    return font_path


def test_font_arabic_mark_codepoints_filters_to_mn_in_arabic_blocks(
    tmp_path: Path,
) -> None:
    # 0x064B (fathatan) is Mn in the Arabic block; 0x0041 ("A") is Latin, not Mn.
    font_path = _build_font_with_cmap(tmp_path, [0x064B, 0x0041])
    assert marks.font_arabic_mark_codepoints(font_path) == {0x064B}


def test_font_not_found_raises_clear_error(tmp_path: Path) -> None:
    with pytest.raises(marks.MarksError, match="run `sawa build fonts`"):
        marks.font_arabic_mark_codepoints(tmp_path / "missing.woff2")


def test_missing_fonttools_raises_clear_error(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    font_path = _build_font_with_cmap(tmp_path, [0x064B])
    monkeypatch.setitem(sys.modules, "fontTools.ttLib", None)
    with pytest.raises(marks.MarksError, match=r"build.*dependency group"):
        marks.font_arabic_mark_codepoints(font_path)


def test_check_marks_passes_when_font_marks_are_all_grouped(tmp_path: Path) -> None:
    font_path = _build_font_with_cmap(tmp_path, [0x064B, 0x064C])
    groups_path = write_groups(
        tmp_path, [{"id": "tanween", "codepoints": ["U+064B..U+064D"]}]
    )
    result = marks.check_marks(groups_path=groups_path, font_path=font_path)
    assert result.errors == []


def test_check_marks_reports_ungrouped_font_mark(tmp_path: Path) -> None:
    font_path = _build_font_with_cmap(tmp_path, [0x064B, 0x0652])
    groups_path = write_groups(tmp_path, [{"id": "tanween", "codepoints": ["U+064B"]}])
    result = marks.check_marks(groups_path=groups_path, font_path=font_path)
    assert any("U+0652" in error for error in result.errors)


def test_check_marks_skips_font_check_when_groups_are_invalid(tmp_path: Path) -> None:
    groups_path = write_groups(tmp_path, [{"id": "bad", "codepoints": ["nope"]}])
    result = marks.check_marks(
        groups_path=groups_path, font_path=tmp_path / "missing.woff2"
    )
    assert any("invalid codepoint" in error for error in result.errors)


def test_cli_exits_1_on_ungrouped_mark(tmp_path: Path) -> None:
    font_path = _build_font_with_cmap(tmp_path, [0x064B, 0x0652])
    groups_path = write_groups(tmp_path, [{"id": "tanween", "codepoints": ["U+064B"]}])
    exit_code = main(
        [
            "check",
            "marks",
            "--groups",
            str(groups_path),
            "--font",
            str(font_path),
        ]
    )
    assert exit_code == 1


def test_cli_exits_0_on_full_coverage(tmp_path: Path) -> None:
    font_path = _build_font_with_cmap(tmp_path, [0x064B])
    groups_path = write_groups(
        tmp_path, [{"id": "tanween", "codepoints": ["U+064B..U+064D"]}]
    )
    exit_code = main(
        [
            "check",
            "marks",
            "--groups",
            str(groups_path),
            "--font",
            str(font_path),
        ]
    )
    assert exit_code == 0


@pytest.mark.parametrize("font", marks.DEFAULT_FONTS, ids=lambda p: p.stem)
def test_real_sawa_family_has_full_mark_coverage(font: Path) -> None:
    font_path = REPO_ROOT / font
    if not font_path.exists():
        pytest.skip("font not built; run `uv run --group build sawa build fonts` first")
    result = marks.check_marks(groups_path=REAL_GROUPS, font_path=font_path)
    assert result.errors == []
