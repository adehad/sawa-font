from __future__ import annotations

from pathlib import Path

from sawa_tools.report.coverage import block_coverage, glyphset_codepoints
from sawa_tools.report.metrics import family_metrics
from sawa_tools.report.shaping import (
    GLYPH_FIELDS,
    compare,
    compare_family,
    dump_snapshot,
    load_snapshot,
    summarise,
)

ROWS = [["beh", 1, 600, 0, 0, 0], ["alef", 0, 300, 0, 0, 0]]


def test_matching_shaping_passes() -> None:
    assert compare(ROWS, [list(row) for row in ROWS]) == {"status": "pass", "glyphs": 2}


def test_mismatch_reports_the_first_differing_glyph() -> None:
    moved = [ROWS[0], ["alef", 0, 300, 0, 12, 0]]
    result = compare(ROWS, moved)
    assert result["status"] == "fail"
    assert result["firstDiff"] == {"index": 1, "expected": ROWS[1], "actual": moved[1]}


def test_extra_glyph_is_a_mismatch_past_the_expected_end() -> None:
    result = compare(ROWS, [*ROWS, ["space", 2, 250, 0, 0, 0]])
    assert result["firstDiff"]["index"] == 2
    assert result["firstDiff"]["expected"] is None


def test_missing_snapshot_and_summary_counts() -> None:
    actual = {"a": {"wght=400": ROWS}, "b": {"wght=400": ROWS}}
    results = {"fam": compare_family({"a": {"wght=400": ROWS}}, actual)}
    assert summarise(results) == {"pass": 1, "fail": 0, "missing": 1}


def test_snapshot_round_trips_one_glyph_per_line(tmp_path: Path) -> None:
    snapshot = {"t": {"wght=400": ROWS, "wght=700": ROWS[:1]}}
    text = dump_snapshot("fam", snapshot)
    assert '        ["beh", 1, 600, 0, 0, 0],' in text.splitlines()
    path = tmp_path / "fam.json"
    path.write_text(text, encoding="utf-8")
    assert load_snapshot(path) == snapshot
    assert GLYPH_FIELDS[0] == "name"


def test_metrics_shape(make_font) -> None:
    metrics = family_metrics(make_font(ascent=900, descent=-300))
    assert metrics["unitsPerEm"] == 1000
    assert set(metrics) >= {"hhea", "typo", "win", "useTypoMetrics", "lineBox", "axes"}
    assert metrics["lineBox"]["height"] == 1.2
    assert metrics["xHeight"] == 500 and metrics["capHeight"] == 700


def test_block_coverage_counts_only_mappable_codepoints() -> None:
    coverage = block_coverage({0x00, 0x41, 0x42}, {"Basic Latin"})
    # 128 codepoints minus 33 controls; U+0000 is a control and not counted.
    assert coverage == {"Basic Latin": {"supported": 2, "total": 95}}


def test_glyphsets_include_gf_latin_core_and_romanisation() -> None:
    sets = glyphset_codepoints()
    assert ord("A") in sets["GF_Latin_Core"]
    assert ord("ḥ") in sets["arabic-romanisation"]


def test_private_use_is_not_counted() -> None:
    coverage = block_coverage({0xE000}, {"Private Use Area"})
    assert coverage == {"Private Use Area": {"supported": 0, "total": 0}}
