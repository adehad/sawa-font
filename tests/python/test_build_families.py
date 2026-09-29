import json
from pathlib import Path
from types import SimpleNamespace

import pytest

pytest.importorskip("fontTools")

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

from sawa_tools.build import families, merge, naming
from sawa_tools.build.fonts import _extract_axes
from sawa_tools.checks import fonts as fonts_check

REPO_ROOT = Path(__file__).parents[2]
WGHT = merge.WghtRange(400.0, 400.0, 700.0)
RELEASE = naming.Release("0.001", "TEST", "Test modifications.")


def test_snap_rounds_f2dot14_round_trips_to_design_stops() -> None:
    assert merge.snap([699.99, 400.004, 550.02]) == {700.0, 400.0, 550.0}


def test_snap_refuses_a_real_fractional_stop() -> None:
    with pytest.raises(ValueError, match=r"550\.5"):
        merge.snap([550.5])


def test_denormalize_uses_the_span_on_each_side_of_default() -> None:
    axis = merge.WghtRange(100.0, 400.0, 900.0)
    assert merge.denormalize(-1.0, axis) == 100.0
    assert merge.denormalize(0.5, axis) == 650.0
    assert merge.denormalize(1.0, axis) == 900.0


def test_unmap_avar_inverts_a_segment_map() -> None:
    segments = {-1.0: -1.0, 0.0: 0.0, 0.5: 0.25, 1.0: 1.0}
    assert merge.unmap_avar(segments, 0.25) == 0.5
    assert merge.unmap_avar(segments, 0.625) == pytest.approx(0.75)


def test_master_locations_keep_breakpoints_inside_the_range() -> None:
    assert merge.master_locations({100.0, 500.0, 900.0}, WGHT) == [
        400.0,
        500.0,
        700.0,
    ]


def test_split_gives_arabic_its_script_and_what_latin_lacks() -> None:
    latin = {0x20, 0x2C, 0x41, 0x0660}
    arabic = {0x20, 0x2C, 0x060C, 0x0628, 0x0660, 0xFDFD}
    latin_owned, arabic_owned = merge.split_codepoints(latin, arabic)
    assert latin_owned == {0x20, 0x2C, 0x41}
    assert arabic_owned == {0x060C, 0x0628, 0x0660, 0xFDFD}


def test_derive_metrics_holds_both_scripts_and_the_ink_extent() -> None:
    metrics = merge.derive_metrics((1000, -300), (900, -600), 1.1, (-700.4, 1200.2))
    assert metrics == merge.LineMetrics(
        ascender=1000, descender=-660, line_gap=0, win_ascent=1200, win_descent=700
    )


def test_derive_metrics_win_never_smaller_than_typo() -> None:
    metrics = merge.derive_metrics((1000, -300), (900, -600), 1.0, (-10.0, 10.0))
    assert (metrics.win_ascent, metrics.win_descent) == (1000, 600)


def test_named_weights_cover_the_range() -> None:
    assert naming.named_weights(400, 700) == [400, 500, 600, 700]


def test_merged_names_keep_upstream_names_out_of_family_ids() -> None:
    names = naming.merged_names(
        "Sawa Serif",
        release=RELEASE,
        copyrights=["Copyright Noto Authors"],
        derived_from="Noto Serif 2.015 and Noto Naskh Arabic 2.021",
    )
    assert names[6] == "SawaSerif-Regular"
    assert names[3] == "0.001;TEST;SawaSerif-Regular"
    assert "Noto" in names[0] and "Noto" in names[5]
    family_ids = [(i, names[i]) for i in naming.FAMILY_NAME_IDS if i in names]
    assert naming.reserved_name_hits(family_ids, ["Noto"]) == []


def test_merge_copyrights_lists_each_source_once_per_holder() -> None:
    assert naming.merge_copyrights(
        [
            "Copyright 2022 The Noto Project Authors (https://a)",
            "Copyright 2022 The Noto Project Authors (https://b)",
            "Copyright 2022 The Noto Project Authors (https://a)",
            "Copyright Other",
        ]
    ) == [
        "Copyright 2022 The Noto Project Authors (https://a, https://b)",
        "Copyright Other",
    ]


def test_rename_text_replaces_spaced_and_postscript_spellings() -> None:
    assert (
        naming.rename_text(
            "CascadiaMono-Bold / Cascadia Mono", "Cascadia Mono", "Sawa Mono"
        )
        == "SawaMono-Bold / Sawa Mono"
    )


def test_reserved_name_hits_ignore_case() -> None:
    hits = naming.reserved_name_hits(
        [(1, "Sawa Mono"), (4, "cascadia x")], ["Cascadia"]
    )
    assert hits == ["name ID 4: 'cascadia x'"]


def test_stamp_changes_with_each_input() -> None:
    base = families.stamp_digest({"a": 1}, {"v": "1"}, {"src": "aa"}, "code")
    assert base == families.stamp_digest({"a": 1}, {"v": "1"}, {"src": "aa"}, "code")
    assert base != families.stamp_digest({"a": 2}, {"v": "1"}, {"src": "aa"}, "code")
    assert base != families.stamp_digest({"a": 1}, {"v": "2"}, {"src": "aa"}, "code")
    assert base != families.stamp_digest({"a": 1}, {"v": "1"}, {"src": "bb"}, "code")
    assert base != families.stamp_digest({"a": 1}, {"v": "1"}, {"src": "aa"}, "new")


def test_is_fresh_needs_matching_stamp_and_every_output(tmp_path: Path) -> None:
    stamp, output = tmp_path / "f.stamp", tmp_path / "f.ttf"
    assert not families.is_fresh(stamp, "abc", [output])
    stamp.write_text("abc\n", encoding="utf-8")
    assert not families.is_fresh(stamp, "abc", [output])
    output.write_bytes(b"x")
    assert families.is_fresh(stamp, "abc", [output])
    assert not families.is_fresh(stamp, "def", [output])


def test_code_version_is_stable() -> None:
    assert families.code_version() == families.code_version()


def test_repo_config_loads() -> None:
    config = families.load_config(REPO_ROOT / "data" / "sawa.json")
    ids = [family.id for family in config.families]
    assert ids == ["sawa-serif", "sawa-sans", "sawa-mono", "sawa-mono-nf"]
    nf = config.families[-1]
    assert nf.generic is None and nf.ttf_name == "SawaMonoNF[wght].ttf"


def _family(**overrides: object) -> dict:
    raw: dict = {
        "name": "Sawa Test",
        "kind": "rename",
        "input": {"source": "src", "path": "a.ttf"},
        "renameFrom": "Old",
        "notice": "Derived.",
        "wght": {"min": 400, "default": 400, "max": 700},
        "metrics": {
            "policy": "source",
            "ascender": 800,
            "descender": -200,
            "lineGap": 0,
            "winAscent": 900,
            "winDescent": 250,
        },
        "licence": [{"source": "src"}],
        "site": {"generic": "monospace"},
    }
    raw.update(overrides)
    return raw


def _write_config(tmp_path: Path, family: dict) -> Path:
    path = tmp_path / "sawa.json"
    path.write_text(
        json.dumps(
            {
                "release": {"version": "1", "vendor": "T", "copyright": "c"},
                "families": {"test": family},
            }
        ),
        encoding="utf-8",
    )
    return path


def test_config_rejects_a_policy_that_does_not_fit_the_kind(tmp_path: Path) -> None:
    raw = _family()
    raw["metrics"]["policy"] = "shared"
    with pytest.raises(families.FamilyError, match="policy must be 'source'"):
        families.load_config(_write_config(tmp_path, raw))


def test_config_rejects_an_unknown_kind(tmp_path: Path) -> None:
    with pytest.raises(families.FamilyError, match="'kind'"):
        families.load_config(_write_config(tmp_path, _family(kind="copy")))


def test_config_requires_rename_from_for_a_rename(tmp_path: Path) -> None:
    raw = _family()
    del raw["renameFrom"]
    with pytest.raises(families.FamilyError, match="renameFrom"):
        families.load_config(_write_config(tmp_path, raw))


def _variable_font() -> object:
    builder = FontBuilder(unitsPerEm=1000, isTTF=True)
    builder.setupGlyphOrder([".notdef"])
    builder.setupCharacterMap({})
    builder.setupGlyf({".notdef": TTGlyphPen(None).glyph()})
    builder.setupHorizontalMetrics({".notdef": (500, 0)})
    builder.setupHorizontalHeader(ascent=800, descent=-200)
    builder.setupNameTable({"familyName": "Test", "styleName": "Regular"})
    builder.setupFvar(
        axes=[("wght", 100, 400, 900, "Weight")],
        instances=[
            {"location": {"wght": 400}, "stylename": "Regular"},
            {"location": {"wght": 700}, "stylename": "Bold"},
        ],
    )
    return builder.font


def test_extract_axes_reads_fvar_axes_and_instances() -> None:
    axes, instances = _extract_axes(_variable_font())
    assert axes == [{"tag": "wght", "min": 100, "default": 400, "max": 900}]
    assert instances == [
        {"name": "Regular", "coords": {"wght": 400}},
        {"name": "Bold", "coords": {"wght": 700}},
    ]


def test_coverage_gaps_are_removed_before_shaping() -> None:
    gaps = fonts_check.gap_codepoints(["U+06D6..U+06D7", "U+08F0"])
    assert gaps == {0x06D6, 0x06D7, 0x08F0}
    assert fonts_check.without("aۖbࣰ", gaps) == "ab"


def test_advance_errors_flag_widths_off_the_cell() -> None:
    hmtx = SimpleNamespace(metrics={"a": (1200, 0), "mark": (0, 0), "w": (2400, 0)})
    font = {"hmtx": hmtx}
    assert fonts_check.advance_errors(font, 1200, "default") == [
        "default: advances [2400] are neither 0 nor the cell width 1200"
    ]
