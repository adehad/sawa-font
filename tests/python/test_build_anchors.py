from __future__ import annotations

import io
from collections.abc import Callable
from typing import Any

import pytest

pytest.importorskip("fontTools")
pytest.importorskip("uharfbuzz")

from fontTools.ttLib import TTFont

from sawa_tools.build import anchors, merge
from sawa_tools.build.harfbuzz import Shaper

WGHT = merge.WghtRange(400.0, 400.0, 700.0)
Master = Callable[..., TTFont]


def _markbase_top(font: TTFont) -> Any:
    return next(s for s in anchors.slots(font) if s.role == "base" and s.side == "top")


def _mark_anchor(font: TTFont, glyph: str) -> tuple[int, int]:
    sub = _markbase_top(font).subtable
    record = sub.MarkArray.MarkRecord[sub.MarkCoverage.glyphs.index(glyph)]
    return record.MarkAnchor.XCoordinate, record.MarkAnchor.YCoordinate


def _shaped(font: TTFont, text: str, wght: float | None = None) -> list[Any]:
    buffer = io.BytesIO()
    font.save(buffer)
    shaper = Shaper(buffer.getvalue(), {"wght": wght} if wght else None)
    return shaper.shape(text)


def test_a_mark_no_letter_positions_is_stray(arabic_master: Master) -> None:
    assert anchors.stray_marks(arabic_master()) == {"smallhightah": "top"}


def test_placement_follows_the_combining_class() -> None:
    assert anchors.placement(0x0615) == "top"
    assert anchors.placement(0x0650) == "bottom"
    assert anchors.placement(0x08D3) == "bottom"
    assert anchors.placement(0x064B) == "top"


def test_stray_mark_joins_every_top_slot_with_an_anchor_from_its_ink(
    arabic_master: Master,
) -> None:
    master = arabic_master()
    anchors.anchor_masters({400.0: master}, 400.0, 0.03)
    assert anchors.stray_marks(master) == {}
    # fatha's anchor is 20 units under its ink's bottom centre.
    assert _mark_anchor(master, "smallhightah") == (75, 880)
    for slot in anchors.slots(master):
        if slot.side != "top":
            continue
        sub = slot.subtable
        coverage = (
            sub.Mark2Coverage
            if slot.role == "mark2"
            else (sub.Mark1Coverage if slot.role == "mark1" else sub.MarkCoverage)
        )
        assert "smallhightah" in coverage.glyphs, slot.role
    gdef = master["GDEF"].table
    assert gdef.GlyphClassDef.classDefs["smallhightah"] == 3
    assert master["hmtx"]["smallhightah"][0] == 0


def test_an_anchored_mark_follows_its_letter(arabic_master: Master) -> None:
    master = arabic_master()
    anchors.anchor_masters({400.0: master}, 400.0, 0.03)
    on_alef = _shaped(master, "\u0627\u0615")
    on_beh = _shaped(master, "\u0628\u0615")
    # Each mark lands with its anchor on the letter's top anchor.
    assert on_alef[-1].y == 800 - 880
    assert on_beh[-1].y == 200 - 880


def test_masters_stay_compatible_and_anchors_vary(arabic_master: Master) -> None:
    masters = {400.0: arabic_master(), 700.0: arabic_master(rise=40)}
    anchors.anchor_masters(masters, 400.0, 0.03)
    assert _mark_anchor(masters[400.0], "smallhightah") == (75, 880)
    assert _mark_anchor(masters[700.0], "smallhightah") == (75, 920)
    font = merge.build_variable(masters, WGHT)
    for wght, anchor_y in ((400, 880), (700, 920)):
        mark = _shaped(font, "\u0627\u0615", wght)[-1]
        assert mark.y == 800 - anchor_y


def test_a_mark_stacked_on_another_clears_its_ink(arabic_master: Master) -> None:
    master = arabic_master(stack_y=780)
    anchors.anchor_masters({400.0: master}, 400.0, 0.03)
    fatha, tah = _shaped(master, "اَؕ")[1:]
    # fatha's ink tops out at 860; smallhightah's starts 900 above its origin.
    assert 900 + tah.y >= 860 + fatha.y + 30 - 1
