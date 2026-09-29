from __future__ import annotations

from collections.abc import Callable
from typing import Any

import pytest

pytest.importorskip("fontTools")

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.ttGlyphPen import TTGlyphPen

from sawa_tools.build import borrow

Master = Callable[..., Any]


def _box(x0: int, y0: int, x1: int, y1: int) -> Any:
    pen = TTGlyphPen(None)
    pen.moveTo((x0, y0))
    pen.lineTo((x0, y1))
    pen.lineTo((x1, y1))
    pen.lineTo((x1, y0))
    pen.closePath()
    return pen.glyph()


def _lender() -> Any:
    glyphs = {
        ".notdef": TTGlyphPen(None).glyph(),
        "uni0657": _box(10, 500, 60, 560),
        "uni02BE": _box(10, 400, 50, 500),
    }
    builder = FontBuilder(unitsPerEm=1000, isTTF=True)
    builder.setupGlyphOrder(list(glyphs))
    builder.setupCharacterMap({0x0657: "uni0657", 0x02BE: "uni02BE"})
    builder.setupGlyf(glyphs)
    builder.setupHorizontalMetrics(
        {".notdef": (0, 0), "uni0657": (0, 10), "uni02BE": (60, 10)}
    )
    return builder.font


def _ink(font: Any, glyph: str) -> tuple[float, float, float, float]:
    pen = BoundsPen(font.getGlyphSet())
    font.getGlyphSet()[glyph].draw(pen)
    assert pen.bounds is not None
    return pen.bounds


def test_a_borrowed_mark_is_scaled_placed_like_fatha_and_zero_width(
    arabic_master: Master,
) -> None:
    target, lender = arabic_master(), _lender()
    name = borrow.add_glyph(
        target, lender.getGlyphSet(), "uni0657", 0x0657, 2.0, cell_width=1200
    )
    assert target.getBestCmap()[0x0657] == name
    assert target["hmtx"][name][0] == 0
    assert target["GDEF"].table.GlyphClassDef.classDefs[name] == 3
    x0, y0, x1, y1 = _ink(target, name)
    # 50x60 scaled by 2, centred on fatha (x 0..200) and resting on its bottom.
    assert (x1 - x0, y1 - y0) == (100, 120)
    assert ((x0 + x1) / 2, y0) == (100, 800)


def test_a_borrowed_spacing_letter_fills_one_cell_centred(
    arabic_master: Master,
) -> None:
    target, lender = arabic_master(), _lender()
    name = borrow.add_glyph(
        target, lender.getGlyphSet(), "uni02BE", 0x02BE, 2.0, cell_width=1200
    )
    assert target["hmtx"][name][0] == 1200
    assert target["GDEF"].table.GlyphClassDef.classDefs[name] == 1
    x0, y0, x1, y1 = _ink(target, name)
    assert ((x0 + x1) / 2, y0, y1) == (600, 800, 1000)


def test_ink_scale_is_the_mean_height_ratio(arabic_master: Master) -> None:
    target, lender = arabic_master(), _lender()
    lender["cmap"].tables[0].cmap[0x064E] = "uni0657"
    lender["cmap"].tables[0].cmap[0x0650] = "uni02BE"
    # Target fatha and kasra are 60 tall; the lender's stand-ins 60 and 100.
    assert borrow.ink_scale(target, lender, [0x064E, 0x0650], {}) == 0.8


def test_a_name_clash_is_refused(arabic_master: Master) -> None:
    target = arabic_master()
    with pytest.raises(borrow.BorrowError, match="fatha"):
        borrow.add_glyph(target, target.getGlyphSet(), "fatha", 0x0657, 1.0, None)
