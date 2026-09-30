from __future__ import annotations

from collections.abc import Callable
from typing import Any

import pytest

pytest.importorskip("fontTools")

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont, newTable
from fontTools.ttLib.tables._g_l_y_f import Glyph, GlyphComponent

from sawa_tools.build import polish

Master = Callable[..., TTFont]


def _component(name: str, x: int, y: int, scale: float | None = None) -> Any:
    component = GlyphComponent()
    component.glyphName, component.x, component.y, component.flags = name, x, y, 0
    if scale is not None:
        component.transform = [[scale, 0], [0, scale]]
    return component


def _composite(*components: Any) -> Glyph:
    glyph = Glyph()
    glyph.numberOfContours = -1
    glyph.components = list(components)
    return glyph


def _nested_font() -> TTFont:
    """dot is a triangle, pair two dots and stack a dot and a half-size pair."""
    pen = TTGlyphPen(None)
    pen.moveTo((0, 0))
    pen.lineTo((0, 100))
    pen.lineTo((50, 100))
    pen.closePath()
    glyphs: dict[str, Any] = {
        ".notdef": TTGlyphPen(None).glyph(),
        "dot": pen.glyph(),
        "pair": _composite(_component("dot", 0, 0), _component("dot", 200, 0)),
        "stack": _composite(
            _component("dot", 0, 0), _component("pair", 10, 300, scale=0.5)
        ),
    }
    builder = FontBuilder(unitsPerEm=1000, isTTF=True)
    builder.setupGlyphOrder(list(glyphs))
    builder.setupGlyf(glyphs)
    builder.setupHorizontalMetrics({g: (500, 0) for g in glyphs})
    builder.setupHorizontalHeader(ascent=800, descent=-200)
    builder.setupMaxp()
    return builder.font


def test_nested_components_flatten_to_the_same_outline() -> None:
    font = _nested_font()
    glyf = font["glyf"]
    before = glyf["stack"].getCoordinates(glyf)[0]
    assert polish.flatten_components(font) == ["stack"]
    names = [c.glyphName for c in glyf["stack"].components]
    assert names == ["dot", "dot", "dot"]
    assert list(glyf["stack"].getCoordinates(glyf)[0]) == list(before)
    assert polish.flatten_components(font) == []


def test_smart_dropout_is_created_once_or_appended() -> None:
    font = _nested_font()
    assert polish.smart_dropout(font) == "created"
    assert "gasp" in font
    assert polish.smart_dropout(font) == "present"
    font["prep"].program.fromBytecode(b"\xb0\x01")
    assert polish.smart_dropout(font) == "appended"
    assert font["prep"].program.getBytecode() == b"\xb0\x01" + polish.SMART_DROPOUT


def test_macintosh_names_go() -> None:
    font = _nested_font()
    font["name"] = newTable("name")
    font["name"].names = []
    font["name"].setName("Sawa", 1, 3, 1, 0x409)
    font["name"].setName("Sawa", 1, 1, 0, 0)
    assert polish.drop_mac_names(font) == 1
    assert [r.platformID for r in font["name"].names] == [3]


def test_a_high_hamza_classed_as_a_mark_becomes_a_spacing_base(
    arabic_master: Master,
) -> None:
    font = arabic_master()
    font["hmtx"]["smallhightah"] = (300, 0)
    for subtable in font["cmap"].tables:
        subtable.cmap[polish.HIGH_HAMZA] = "smallhightah"
    assert polish.high_hamza_base(font)
    assert font["GDEF"].table.GlyphClassDef.classDefs["smallhightah"] == 1
    assert not polish.high_hamza_base(font)
