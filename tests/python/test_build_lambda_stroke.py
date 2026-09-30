from __future__ import annotations

from typing import Any

import pytest

pytest.importorskip("fontTools")

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont

from sawa_tools.build import lambda_stroke

Polygon = list[tuple[int, int]]

L_SHAPE: Polygon = [(100, 0), (100, 700), (200, 700), (200, 100), (500, 100), (500, 0)]
LONG_LEG: Polygon = [(300, 0), (380, 0), (180, 700), (100, 700)]
SHORT_LEG: Polygon = [(60, 0), (140, 0), (260, 300), (200, 330)]
# The legs of Λ, meeting at its apex.
LEFT_LEG: Polygon = [(50, 0), (130, 0), (330, 700), (270, 700)]
RIGHT_LEG: Polygon = [(470, 0), (550, 0), (330, 700), (270, 700)]
SLASH: Polygon = [(40, 300), (40, 360), (260, 460), (260, 400)]
LAMBDA_SLASH: Polygon = [(120, 420), (120, 480), (360, 580), (360, 520)]


def _glyph(*polygons: Polygon) -> Any:
    pen = TTGlyphPen(None)
    for polygon in polygons:
        pen.moveTo(polygon[0])
        for point in polygon[1:]:
            pen.lineTo(point)
        pen.closePath()
    return pen.glyph()


def _font() -> TTFont:
    glyphs = {
        ".notdef": TTGlyphPen(None).glyph(),
        "L": _glyph(L_SHAPE),
        "Lslash": _glyph(L_SHAPE, SLASH),
        "lambda": _glyph(LONG_LEG, SHORT_LEG),
        "uni019B": _glyph(LONG_LEG, SHORT_LEG, LAMBDA_SLASH),
        "Lambda": _glyph(LEFT_LEG, RIGHT_LEG),
    }
    builder = FontBuilder(unitsPerEm=1000, isTTF=True)
    builder.setupGlyphOrder(list(glyphs))
    builder.setupCharacterMap(
        {0x4C: "L", 0x141: "Lslash", 0x3BB: "lambda", 0x19B: "uni019B", 0x39B: "Lambda"}
    )
    builder.setupGlyf(glyphs)
    glyf = builder.font["glyf"]
    for glyph in glyphs.values():
        glyph.recalcBounds(glyf)
    builder.setupHorizontalMetrics(
        {g: (600, getattr(glyph, "xMin", 0)) for g, glyph in glyphs.items()}
    )
    builder.setupHorizontalHeader(ascent=800, descent=-200)
    builder.setupMaxp()
    from fontTools.feaLib.builder import addOpenTypeFeaturesFromString

    addOpenTypeFeaturesFromString(
        builder.font, "table GDEF { GlyphClassDef [L Lambda], , , ; } GDEF;"
    )
    return builder.font


def test_the_capital_is_lambda_with_a_stroke_across_its_right_leg() -> None:
    font = _font()
    assert lambda_stroke.add_capital_lambda_with_stroke({400.0: font}, 400.0) == (
        "uniA7DC"
    )
    assert (font.getBestCmap() or {})[0xA7DC] == "uniA7DC"
    assert font["hmtx"]["uniA7DC"][0] == 600
    assert font["GDEF"].table.GlyphClassDef.classDefs["uniA7DC"] == 1
    glyf = font["glyf"]
    glyph = glyf["uniA7DC"]
    assert glyph.numberOfContours == 3
    corners = lambda_stroke.stroke(font)
    xs, ys = [p[0] for p in corners], [p[1] for p in corners]
    # Centred at 0.55 of Λ's height, where the right leg runs from x 360
    # to 429, and across all of it.
    assert sum(ys) / 4 == pytest.approx(0.55 * 700, abs=1)
    assert min(xs) < 360 and max(xs) > 429
    # As thick as L's stem at least: 100.
    assert max(ys) - min(ys) >= 100
    assert lambda_stroke.add_capital_lambda_with_stroke({400.0: font}, 400.0) is None
