from __future__ import annotations

from collections import Counter
from pathlib import Path
from typing import Any

import pytest

from sawa_tools.checks import leading
from sawa_tools.corpus import Part


def test_any_line_can_sit_under_the_lowest_line() -> None:
    extents = [(1.0, -0.5), (1.2, -0.3), None, (1.3, -0.4)]
    # The lowest bottom is -0.5; the highest top 1.3, three lines away.
    assert leading.collisions(extents, 1.6) == [1, 3]
    assert leading.collisions(extents, 1.8) == []
    assert leading.zero_collision_pitch(extents) == pytest.approx(1.8)


def test_inside_share_counts_lines_within_the_box() -> None:
    box = leading.Box(1.1, -0.5)
    extents = [(1.0, -0.4), (1.2, -0.4), (1.0, -0.6), (0.9, -0.1), None]
    assert leading.inside_share(extents, box) == pytest.approx(0.5)


def _result(
    extents: dict[str, list[leading.Extent]], contacts: int = 0
) -> leading.Result:
    result = leading.Result("f", 400.0, 1000, extents)
    if contacts:
        result.contacts = Counter({"between base: kasra waw": contacts})
    return result


def test_a_family_box_that_holds_the_corpus_passes() -> None:
    result = _result({"quran": [(1100.0, -500.0), (1150.0, -520.0)]})
    summary = leading.summarise(result, leading.Box(1.16, -0.52))
    assert summary.collisions == 0
    assert leading.errors(summary, result) == []


def test_collisions_and_contacts_are_errors() -> None:
    result = _result({"quran": [(1100.0, -700.0), (1300.0, -500.0)]}, contacts=3)
    summary = leading.summarise(result, leading.Box(1.2, -0.5))
    found = leading.errors(summary, result)
    assert summary.collisions == 2
    assert any("lines reach the lowest line" in e for e in found)
    assert summary.inside == 0.0
    assert any("3 mark contacts" in e for e in found)


def test_lines_of_different_parts_can_be_neighbours() -> None:
    result = _result({"quran": [(1000.0, -800.0)], "stress": [(1500.0, -100.0)]})
    assert leading.summarise(result, leading.Box(1.5, -0.5)).collisions == 1
    summary = leading.summarise(result, leading.Box(1.5, -0.8))
    assert summary.zero_collision == pytest.approx(2.3)
    assert summary.ink_split == leading.Box(1.5, -0.8)


def test_ink_past_the_win_metrics_is_an_error() -> None:
    result = _result({"quran": [(1100.0, -500.0), (1150.0, -520.0)]})
    box = leading.Box(1.16, -0.52)
    clipped = leading.summarise(result, box, leading.Box(1.1, -0.6))
    assert any("win metrics" in e for e in leading.errors(clipped, result))
    whole = leading.summarise(result, box, leading.Box(1.2, -0.6))
    assert leading.errors(whole, result) == []


def test_the_everyday_view_drops_niche_marks_and_their_spaces() -> None:
    from sawa_tools.corpus import everyday, is_niche_mark

    # fatha, superscript alef and small high rounded zero; a pause mark.
    assert not is_niche_mark(0x064E)
    assert not is_niche_mark(0x0670)
    assert is_niche_mark(0x06DF)
    assert is_niche_mark(0x06D6)
    assert everyday("بَ۟ ۖ بٰ") == ("بَ بٰ")


def test_niche_collisions_and_contacts_are_reported_not_failed() -> None:
    result = _result({"quran": [(1100.0, -500.0), (1150.0, -520.0)]})
    result.full = {"quran": [(1100.0, -700.0), (1400.0, -520.0)]}
    result.niche = Counter({"within mark: fatha smallhighzero": 2})
    summary = leading.summarise(result, leading.Box(1.2, -0.52), leading.Box(1.5, -0.8))
    assert summary.collisions == 0
    assert summary.niche_collisions == 2
    assert summary.niche_contacts == 2
    assert leading.errors(summary, result) == []


def test_niche_ink_past_the_win_metrics_still_fails() -> None:
    result = _result({"quran": [(1100.0, -500.0), (1150.0, -520.0)]})
    result.full = {"quran": [(1100.0, -500.0), (1600.0, -520.0)]}
    summary = leading.summarise(result, leading.Box(1.2, -0.52), leading.Box(1.5, -0.8))
    assert any("win metrics" in e for e in leading.errors(summary, result))


def test_measure_finds_a_fatha_shifted_into_its_letter(
    arabic_master: Any, tmp_path: Path
) -> None:
    pytest.importorskip("uharfbuzz")
    font = arabic_master()
    path = tmp_path / "clear.ttf"
    font.save(path)
    parts = [Part("stress", (("fatha-on-alef", "\u0627\u064e"),))]
    clear = leading.measure("f", path, 400.0, parts, 0.03)
    assert sum(clear.contacts.values()) == 0
    # Move fatha down onto alef's ink, which tops out at 750.
    for lookup in font["GPOS"].table.LookupList.Lookup:
        for sub in lookup.SubTable:
            if lookup.LookupType == 4 and "fatha" in sub.MarkCoverage.glyphs:
                record = sub.MarkArray.MarkRecord[
                    sub.MarkCoverage.glyphs.index("fatha")
                ]
                record.MarkAnchor.YCoordinate += 100
    font.save(path)
    touching = leading.measure("f", path, 400.0, parts, 0.03)
    assert touching.contacts == Counter({"within base: fatha alef": 1})


def test_box_parts_size_the_box_from_their_lines_only() -> None:
    result = _result({"mixed": [(900.0, -400.0)], "stress": [(1500.0, -700.0)]})
    summary = leading.summarise(result, leading.Box(0.9, -0.4), None, ["mixed"])
    assert summary.zero_collision == pytest.approx(1.3)
    assert summary.collisions == 0
    assert leading.errors(summary, result) == []
