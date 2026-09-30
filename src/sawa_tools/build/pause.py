"""Turns the Quranic pause marks into spacing glyphs, per master.

A pause mark (U+06D6 to U+06DC) follows the word or the space it annotates
and sits above the line, where no stack of harakat can reach it. As a
spacing glyph it takes an advance of its own (its ink width plus a side
bearing each side, or the cell width of a monospace family, centred), a GDEF
base class and one fixed height: its ink starts where a reference mark's ink
starts over a short letter, fatha over dotless beh by default. It leaves
every mark-positioning subtable and mark filtering set.

HarfBuzz zeroes the advance only of GDEF marks, so the glyph keeps its
advance although Unicode classes the character as a nonspacing mark.
"""

from __future__ import annotations

import io
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from sawa_tools.build.anchors import table
from sawa_tools.build.harfbuzz import Shaper

if TYPE_CHECKING:
    from collections.abc import Iterable, Mapping

    from fontTools.ttLib import TTFont

_MARK_BASE, _MARK_LIG, _MARK_MARK, _EXTENSION = 4, 5, 6, 9
_BASE_GLYPH_CLASS = 1


class PauseError(Exception):
    """Raised when a master lacks what the pause marks are measured against."""


@dataclass(frozen=True)
class PauseMarks:
    codepoints: tuple[int, ...]
    # Em, each side of the ink.
    side_bearing: float
    # The ink bottom is `mark`'s ink bottom as HarfBuzz places it on `on`.
    mark: int
    on: int
    cell_width: int | None = None


def _bytes(font: TTFont) -> bytes:
    buffer = io.BytesIO()
    font.save(buffer)
    return buffer.getvalue()


def pause_glyphs(font: TTFont, codepoints: Iterable[int]) -> list[str]:
    """The glyphs HarfBuzz shapes the pause marks to, after a space and
    after a letter, in glyph order.
    """
    shaper = Shaper(_bytes(font))
    order = font.getGlyphOrder()
    cmap = font.getBestCmap() or {}
    found: set[str] = set()
    for cp in codepoints:
        if cp not in cmap:
            continue
        found.add(cmap[cp])
        for before in (" ", "ب", "بَ"):
            if not all(ord(ch) in cmap for ch in before):
                continue
            without = {g.gid for g in shaper.shape(before)}
            found |= {
                order[g.gid]
                for g in shaper.shape(before + chr(cp))
                if g.gid not in without
            }
    return sorted(found, key=font.getGlyphID)


def _subtables(font: TTFont) -> Iterable[tuple[Any, int, Any]]:
    for lookup in table(font, "GPOS").table.LookupList.Lookup:
        for sub in lookup.SubTable:
            if lookup.LookupType == _EXTENSION:
                yield lookup, sub.ExtensionLookupType, sub.ExtSubTable
            else:
                yield lookup, lookup.LookupType, sub


def _drop(coverage: Any, records: list[Any], glyphs: set[str]) -> None:
    kept = [(g, r) for g, r in zip(coverage.glyphs, records, strict=True)]
    kept = [(g, r) for g, r in kept if g not in glyphs]
    coverage.glyphs = [g for g, _ in kept]
    records[:] = [r for _, r in kept]


def detach(font: TTFont, glyphs: Iterable[str]) -> None:
    """Takes `glyphs` out of every mark subtable, mark filtering set and
    mark attachment class, and classes them as GDEF bases.
    """
    names = set(glyphs)
    for _, kind, sub in _subtables(font):
        if kind in (_MARK_BASE, _MARK_LIG):
            _drop(sub.MarkCoverage, sub.MarkArray.MarkRecord, names)
            sub.MarkArray.MarkCount = len(sub.MarkArray.MarkRecord)
        elif kind == _MARK_MARK:
            _drop(sub.Mark1Coverage, sub.Mark1Array.MarkRecord, names)
            sub.Mark1Array.MarkCount = len(sub.Mark1Array.MarkRecord)
            _drop(sub.Mark2Coverage, sub.Mark2Array.Mark2Record, names)
            sub.Mark2Array.Mark2Count = len(sub.Mark2Array.Mark2Record)
    gdef = table(font, "GDEF").table
    for name in names:
        gdef.GlyphClassDef.classDefs[name] = _BASE_GLYPH_CLASS
        if gdef.MarkAttachClassDef is not None:
            gdef.MarkAttachClassDef.classDefs.pop(name, None)
    if getattr(gdef, "MarkGlyphSetsDef", None):
        for coverage in gdef.MarkGlyphSetsDef.Coverage:
            coverage.glyphs = [g for g in coverage.glyphs if g not in names]


def reference_bottom(font: TTFont, mark: int, on: int) -> float:
    """The ink bottom of `mark` as HarfBuzz places it on `on`."""
    cmap = font.getBestCmap() or {}
    if mark not in cmap or on not in cmap:
        raise PauseError(f"the master lacks U+{mark:04X} or U+{on:04X}")
    shaper = Shaper(_bytes(font))
    glyphs = shaper.shape(chr(on) + chr(mark))
    placed = [g for g in glyphs if g.gid == font.getGlyphID(cmap[mark])]
    glyf = table(font, "glyf")
    if len(placed) != 1:
        raise PauseError(f"U+{mark:04X} does not shape to one glyph on U+{on:04X}")
    glyph = glyf[cmap[mark]]
    glyph.recalcBounds(glyf)
    return glyph.yMin + placed[0].y


def _translate(font: TTFont, name: str, dx: int, dy: int) -> None:
    """Moves `name`'s outline, and moves it back in every composite that
    uses it, so that only the glyph itself changes.
    """
    glyf = table(font, "glyf")
    glyph = glyf[name]
    if glyph.isComposite():
        for component in glyph.components:
            component.x += dx
            component.y += dy
    elif glyph.numberOfContours > 0:
        glyph.coordinates.translate((dx, dy))
    glyph.recalcBounds(glyf)
    for other in font.getGlyphOrder():
        user = glyf[other]
        if other == name or not user.isComposite():
            continue
        for component in user.components:
            if component.glyphName == name:
                component.x -= dx
                component.y -= dy


def make_spacing(font: TTFont, glyphs: Iterable[str], params: PauseMarks) -> None:
    """Step one of the pause marks: `glyphs` become spacing bases."""
    glyphs = list(glyphs)
    upem = table(font, "head").unitsPerEm
    bottom = round(reference_bottom(font, params.mark, params.on))
    side = round(params.side_bearing * upem)
    glyf, hmtx = table(font, "glyf"), table(font, "hmtx")
    detach(font, glyphs)
    for name in glyphs:
        glyph = glyf[name]
        glyph.recalcBounds(glyf)
        if not hasattr(glyph, "xMin"):
            continue
        width = glyph.xMax - glyph.xMin
        if params.cell_width is None:
            advance, left = width + 2 * side, side
        else:
            advance, left = params.cell_width, (params.cell_width - width) // 2
        _translate(font, name, left - glyph.xMin, bottom - glyph.yMin)
        hmtx[name] = (advance, left)


def spacing_masters(
    masters: Mapping[float, TTFont], default: float, params: PauseMarks
) -> list[str]:
    """Makes the pause marks spacing in every master; the glyphs are found
    on the default master. Returns them.
    """
    glyphs = pause_glyphs(masters[default], params.codepoints)
    for master in masters.values():
        make_spacing(master, glyphs, params)
    return glyphs
