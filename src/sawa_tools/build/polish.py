"""Fixes what Fontbakery's universal profile fails in the built families.

Per static master, before varLib: nested composites are flattened, so that
every composite uses simple glyphs only and every master stays compatible;
and U+0674 ARABIC HIGH HAMZA, a letter drawn high, becomes a spacing base
wherever the source classes it as a mark. Per variable font: the five
zero-width tie and overline characters Noto Serif draws across the
neighbouring letters become GDEF marks, the prep program switches on smart
dropout control (a new prep and gasp in an unhinted font, as gftools
fix-nonhinting writes them), and the Macintosh name records go.
"""

from __future__ import annotations

import copy
from typing import TYPE_CHECKING, Any

from fontTools.ttLib import newTable
from fontTools.ttLib.tables import ttProgram
from fontTools.ttLib.tables._g_l_y_f import (
    OVERLAP_COMPOUND,
    ROUND_XY_TO_GRID,
    SCALED_COMPONENT_OFFSET,
    USE_MY_METRICS,
)

from sawa_tools.build.pause import detach

if TYPE_CHECKING:
    from collections.abc import Iterable, Mapping

    from fontTools.ttLib import TTFont

HIGH_HAMZA = 0x0674
# CHARACTER TIE, HYPODIASTOLE, INVERTED UNDERTIE, UNDERTIE and MODIFIER
# BREVE WITH INVERTED BREVE: Pc, Po and Sk, but drawn at zero advance over
# the letters either side.
TIE_MARKS = (0x2040, 0x2E12, 0x2054, 0x203F, 0xAB5B)
# PUSHW 511, SCANCTRL, PUSHB 4, SCANTYPE: dropout control at every size,
# with smart dropout (scan type 4).
SMART_DROPOUT = b"\xb8\x01\xff\x85\xb0\x04\x8d"
# Gridfit, grayscale and both symmetric flags at every size.
_GASP_ALL = 0x000F
_MARK_GLYPH_CLASS = 3
_MAC_PLATFORM = 1


class PolishError(Exception):
    """Raised when a font cannot be fixed the way this module assumes."""


def _table(font: TTFont, tag: str) -> Any:
    return font[tag]


def _matrix(component: Any) -> tuple[tuple[float, float], tuple[float, float]]:
    if hasattr(component, "transform"):
        (a, b), (c, d) = component.transform
        return (a, b), (c, d)
    return (1.0, 0.0), (0.0, 1.0)


def _composed(outer: Any, inner: Any) -> Any:
    """`inner`, a component of the composite `outer` uses, as a component
    of `outer`'s glyph. fontTools maps a point (x, y) to (x, y) times the
    transform plus the offset.
    """
    for component in (outer, inner):
        if not hasattr(component, "x"):
            raise PolishError(f"{component.glyphName}: a point-matched component")
        if component.flags & SCALED_COMPONENT_OFFSET:
            raise PolishError(f"{component.glyphName}: a scaled component offset")
    (a, b), (c, d) = _matrix(outer)
    (e, f), (g, h) = _matrix(inner)
    merged = copy.deepcopy(inner)
    merged.x = round(inner.x * a + inner.y * c + outer.x)
    merged.y = round(inner.x * b + inner.y * d + outer.y)
    transform = [[e * a + f * c, e * b + f * d], [g * a + h * c, g * b + h * d]]
    if transform == [[1, 0], [0, 1]]:
        if hasattr(merged, "transform"):
            del merged.transform
    else:
        merged.transform = transform
    merged.flags = inner.flags & ~USE_MY_METRICS
    merged.flags |= outer.flags & inner.flags & USE_MY_METRICS
    merged.flags |= outer.flags & ROUND_XY_TO_GRID
    return merged


def flatten_components(font: TTFont) -> list[str]:
    """Replaces every component that is itself a composite by that
    composite's own components, all the way down, keeping the points in
    order so that the glyph's instructions still address them. Returns the
    glyphs changed.
    """
    glyf = _table(font, "glyf")
    flat: dict[str, list[Any]] = {}

    def components(name: str) -> list[Any]:
        if name not in flat:
            found = []
            for component in glyf[name].components:
                if glyf[component.glyphName].isComposite():
                    found += [
                        _composed(component, c) for c in components(component.glyphName)
                    ]
                else:
                    found.append(component)
            flat[name] = found
        return flat[name]

    changed = [
        name
        for name in font.getGlyphOrder()
        if glyf[name].isComposite()
        and any(glyf[c.glyphName].isComposite() for c in glyf[name].components)
    ]
    for name in changed:
        components(name)
    for name in changed:
        glyph = glyf[name]
        overlap = glyph.components[0].flags & OVERLAP_COMPOUND
        glyph.components = flat[name]
        glyph.components[0].flags |= overlap
    return changed


def high_hamza_base(font: TTFont) -> bool:
    """Makes U+0674 a spacing base if GDEF classes it as a mark; returns
    whether it did.
    """
    glyph = (font.getBestCmap() or {}).get(HIGH_HAMZA)
    classes = _table(font, "GDEF").table.GlyphClassDef.classDefs
    if glyph is None or classes.get(glyph) != _MARK_GLYPH_CLASS:
        return False
    if _table(font, "hmtx")[glyph][0] <= 0:
        raise PolishError(f"{glyph} (U+0674) has no advance to keep")
    detach(font, [glyph])
    return True


def finish_masters(masters: Mapping[float, TTFont]) -> None:
    for master in masters.values():
        flatten_components(master)
        high_hamza_base(master)


def tie_marks(font: TTFont, codepoints: Iterable[int] = TIE_MARKS) -> list[str]:
    """Classes the zero-advance glyphs of `codepoints` as GDEF marks."""
    cmap = font.getBestCmap() or {}
    hmtx = _table(font, "hmtx")
    classes = _table(font, "GDEF").table.GlyphClassDef.classDefs
    changed = []
    for cp in codepoints:
        glyph = cmap.get(cp)
        if glyph is not None and hmtx[glyph][0] == 0:
            classes[glyph] = _MARK_GLYPH_CLASS
            changed.append(glyph)
    return changed


def smart_dropout(font: TTFont) -> str:
    """Switches on smart dropout control in the prep program: appended to a
    hinted font's, or in a new prep, with a gasp table, in an unhinted one.
    """
    if "prep" in font:
        program = _table(font, "prep").program
        code = program.getBytecode()
        if SMART_DROPOUT in code:
            return "present"
        program.fromBytecode(code + SMART_DROPOUT)
        return "appended"
    if "fpgm" in font:
        raise PolishError("the font has an fpgm but no prep")
    prep: Any = newTable("prep")
    prep.program = ttProgram.Program()
    prep.program.fromBytecode(SMART_DROPOUT)
    font["prep"] = prep
    if "gasp" not in font:
        gasp: Any = newTable("gasp")
        gasp.version = 1
        gasp.gaspRange = {0xFFFF: _GASP_ALL}
        font["gasp"] = gasp
    maxp = _table(font, "maxp")
    maxp.maxStackElements = max(maxp.maxStackElements, 1)
    maxp.maxZones = max(maxp.maxZones, 1)
    return "created"


def drop_mac_names(font: TTFont) -> int:
    name = _table(font, "name")
    before = len(name.names)
    name.names = [r for r in name.names if r.platformID != _MAC_PLATFORM]
    return before - len(name.names)


def finish_font(font: TTFont) -> None:
    tie_marks(font)
    smart_dropout(font)
    drop_mac_names(font)
