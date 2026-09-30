"""Adds glyphs from another variable font to a variable font, master by master.

The target is instanced at each of its variation masters, each borrowed
glyph is drawn from the source instanced at the same wght, scaled to the
target's own glyphs and placed like them, the masters are anchored
(anchors.py) and varLib rebuilds the variable font. Everything the rebuild
does not carry over unchanged is restored from the target: GSUB with its
feature variations, fvar, avar, STAT, name and OS/2.
"""

from __future__ import annotations

import copy
import statistics
import unicodedata
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.recordingPen import DecomposingRecordingPen, RecordingPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.varLib import instancer

from sawa_tools.build.anchors import REFERENCE_MARKS, anchor_masters, placement
from sawa_tools.build.compact import compacted
from sawa_tools.build.masters import anchored
from sawa_tools.build.merge import (
    axis_range,
    build_variable,
    denormalize,
    snap,
    table,
    unmap_avar,
)

if TYPE_CHECKING:
    from collections.abc import Mapping

    from fontTools.ttLib import TTFont

    from sawa_tools.build.compact import Compaction
    from sawa_tools.build.masters import MastersCache
    from sawa_tools.build.merge import WghtRange

Bounds = tuple[float, float, float, float]

_MARK_GLYPH_CLASS = 3
_BASE_GLYPH_CLASS = 1
_RESTORED_TABLES = ("GSUB", "fvar", "avar", "STAT", "name", "OS/2")


class BorrowError(Exception):
    """Raised when a borrowed glyph cannot be added as configured."""


@dataclass(frozen=True)
class Borrowed:
    """Codepoints to take from `source`, sized by the ink height ratio of the
    `scale_from` codepoints between the target and the source.
    """

    source: TTFont
    codepoints: list[int]
    scale_from: list[int]
    pinned: dict[str, float]


def _gdef_classes(font: TTFont) -> dict[str, int]:
    return table(font, "GDEF").table.GlyphClassDef.classDefs


def master_locations(font: TTFont) -> list[float]:
    """User-space wght of every location a region of the font's variations
    starts, peaks or ends at.
    """
    axis = axis_range(font, "wght")
    normalized: set[float] = {-1.0, 0.0, 1.0}
    for variations in table(font, "gvar").variations.values():
        for variation in variations:
            normalized.update(variation.axes.get("wght", ()))
    for tag in ("HVAR", "GDEF", "GPOS"):
        store = getattr(font[tag].table, "VarStore", None) if tag in font else None
        if store:
            for region in store.VarRegionList.Region:
                ra = region.VarRegionAxis[0]
                normalized.update((ra.StartCoord, ra.PeakCoord, ra.EndCoord))
    segments = table(font, "avar").segments.get("wght") if "avar" in font else None
    if segments:
        normalized = {unmap_avar(segments, n) for n in normalized}
    return sorted(snap(denormalize(n, axis) for n in normalized))


def axis_map(font: TTFont) -> list[tuple[float, float]]:
    """The font's avar as a designspace user-to-design map in user units."""
    axis = axis_range(font, "wght")
    segments = table(font, "avar").segments.get("wght") if "avar" in font else None
    if not segments:
        return []
    return sorted(
        (float(round(denormalize(u, axis))), denormalize(d, axis))
        for u, d in segments.items()
    )


def _instance(font: TTFont, wght: float) -> TTFont:
    """The static master at `wght`, with every master keeping the default
    GSUB so that varLib sees one GSUB; the real one is restored afterwards.
    """
    stripped = copy.deepcopy(font)
    gsub = table(stripped, "GSUB").table
    gsub.FeatureVariations = None
    gsub.Version = 0x00010000
    return instancer.instantiateVariableFont(
        stripped, {"wght": wght}, updateFontNames=False
    )


def _bounds(glyphset: Mapping[str, Any], glyph: str) -> Bounds:
    pen = BoundsPen(glyphset)
    glyphset[glyph].draw(pen)
    if pen.bounds is None:
        raise BorrowError(f"glyph {glyph!r} has no ink")
    return pen.bounds


def ink_scale(
    target: TTFont, source: TTFont, codepoints: list[int], pinned: Mapping[str, float]
) -> float:
    """Mean ink-height ratio of `codepoints` from source to target, at each
    font's default location.
    """
    target_set, source_set = target.getGlyphSet(), source.getGlyphSet(location=pinned)
    target_cmap, source_cmap = target.getBestCmap() or {}, source.getBestCmap() or {}
    ratios = []
    for cp in codepoints:
        if cp not in target_cmap or cp not in source_cmap:
            raise BorrowError(f"U+{cp:04X} must be in both fonts to measure scale")
        t = _bounds(target_set, target_cmap[cp])
        s = _bounds(source_set, source_cmap[cp])
        ratios.append((t[3] - t[1]) / (s[3] - s[1]))
    return statistics.mean(ratios)


def _placement_target(
    master: TTFont, cp: int, cell_width: int | None
) -> tuple[str, float, float] | None:
    """Where a borrowed glyph's ink goes: (edge, x centre, edge y). A mark's
    ink centres on the side's reference mark with its facing edge level with
    that mark's; a spacing glyph centres in the cell and keeps its height.
    """
    if unicodedata.category(chr(cp)) != "Mn":
        return None if cell_width is None else ("keep", cell_width / 2, 0.0)
    side = placement(cp)
    reference = (master.getBestCmap() or {}).get(REFERENCE_MARKS[side])
    if reference is None:
        raise BorrowError(f"the target has no U+{REFERENCE_MARKS[side]:04X}")
    x0, y0, x1, y1 = _bounds(master.getGlyphSet(), reference)
    return (
        ("bottom", (x0 + x1) / 2, y0) if side == "top" else ("top", (x0 + x1) / 2, y1)
    )


def add_glyph(
    master: TTFont,
    source_set: Mapping[str, Any],
    source_glyph: str,
    cp: int,
    scale: float,
    cell_width: int | None,
    level: float = 0.0,
) -> str:
    """Adds `source_glyph` to `master` as the glyph for `cp`; returns its name.

    `level` raises a spacing glyph's scaled ink, so that it keeps its height
    relative to the glyphs the scale was measured on.
    """
    order = master.getGlyphOrder()
    name = source_glyph
    if name in order:
        raise BorrowError(f"the target already has a glyph named {name!r}")
    recording = DecomposingRecordingPen(source_set)
    source_set[source_glyph].draw(recording)
    scaled = RecordingPen()
    recording.replay(TransformPen(scaled, (scale, 0, 0, scale, 0, 0)))
    x0, y0, x1, y1 = _recorded_bounds(scaled)
    mark = unicodedata.category(chr(cp)) == "Mn"
    target = _placement_target(master, cp, cell_width)
    dx = dy = 0.0
    if target is not None:
        edge, x_centre, y_edge = target
        dx = x_centre - (x0 + x1) / 2
        if edge == "bottom":
            dy = y_edge - y0
        elif edge == "top":
            dy = y_edge - y1
        else:
            dy = level
    pen = TTGlyphPen(None)
    scaled.replay(TransformPen(pen, (1, 0, 0, 1, round(dx), round(dy))))
    glyph = pen.glyph()
    master.setGlyphOrder([*order, name])
    glyf = table(master, "glyf")
    glyf.glyphOrder = master.getGlyphOrder()
    glyf[name] = glyph
    glyph.recalcBounds(glyf)
    advance = (
        0 if mark else (cell_width or round(source_set[source_glyph].width * scale))
    )
    table(master, "hmtx").metrics[name] = (advance, getattr(glyph, "xMin", 0))
    for subtable in table(master, "cmap").tables:
        if subtable.isUnicode():
            subtable.cmap[cp] = name
    _gdef_classes(master)[name] = _MARK_GLYPH_CLASS if mark else _BASE_GLYPH_CLASS
    return name


def _middle(glyphset: Mapping[str, Any], font: TTFont, codepoints: list[int]) -> float:
    """The mean height of the middle of `codepoints`' inks."""
    cmap = font.getBestCmap() or {}
    boxes = [_bounds(glyphset, cmap[cp]) for cp in codepoints]
    return statistics.mean((b[1] + b[3]) / 2 for b in boxes)


def _recorded_bounds(recording: RecordingPen) -> Bounds:
    pen = BoundsPen(None)
    recording.replay(pen)
    if pen.bounds is None:
        raise BorrowError("a borrowed glyph has no ink")
    return pen.bounds


def borrow_glyphs(
    font: TTFont,
    borrowed: list[Borrowed],
    wght: WghtRange,
    cell_width: int | None,
    clearance_em: float,
    masters_cache: MastersCache | None = None,
    compaction: Compaction | None = None,
) -> TTFont:
    """`font` rebuilt with the borrowed glyphs added, anchored and, with
    `compaction`, compacted.
    """
    masters = anchored(
        masters_cache,
        lambda: _borrowing_masters(font, borrowed, wght, cell_width, clearance_em),
    )
    if compaction is not None:
        masters = compacted(masters, wght.default, compaction, masters_cache)
    rebuilt = build_variable(masters, wght, axis_map(font))
    for tag in _RESTORED_TABLES:
        if tag in font:
            rebuilt[tag] = copy.deepcopy(font[tag])
    os2 = table(rebuilt, "OS/2")
    os2.recalcUnicodeRanges(rebuilt)
    return rebuilt


def _borrowing_masters(
    font: TTFont,
    borrowed: list[Borrowed],
    wght: WghtRange,
    cell_width: int | None,
    clearance_em: float,
) -> dict[float, TTFont]:
    """`font`'s static masters with the borrowed glyphs added, anchored."""
    masters = {w: _instance(font, w) for w in master_locations(font)}
    scales = [ink_scale(font, b.source, b.scale_from, b.pinned) for b in borrowed]
    for location, master in masters.items():
        for entry, scale in zip(borrowed, scales, strict=True):
            source_set = entry.source.getGlyphSet(
                location={**entry.pinned, "wght": location}
            )
            source_cmap = entry.source.getBestCmap() or {}
            level = _middle(master.getGlyphSet(), master, entry.scale_from) - scale * (
                _middle(source_set, entry.source, entry.scale_from)
            )
            for cp in entry.codepoints:
                if cp not in source_cmap:
                    raise BorrowError(f"U+{cp:04X} is not in the borrowed font")
                add_glyph(
                    master, source_set, source_cmap[cp], cp, scale, cell_width, level
                )
    anchor_masters(masters, wght.default, clearance_em)
    return masters
