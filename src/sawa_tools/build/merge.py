"""Merges an Arabic and a Latin variable font into one wght-only variable font.

Per master location: instance both inputs, scale the Arabic, split the
codepoints between them, subset and merge into one static font. The masters
share one set of vertical metrics and are rebuilt into a variable font with
varLib.
"""

from __future__ import annotations

import io
from dataclasses import dataclass
from itertools import pairwise
from typing import TYPE_CHECKING, Any

from fontTools import subset
from fontTools.designspaceLib import (
    AxisDescriptor,
    DesignSpaceDocument,
    SourceDescriptor,
)
from fontTools.merge import Merger
from fontTools.merge import Options as MergeOptions
from fontTools.ttLib import TTFont
from fontTools.ttLib.scaleUpem import scale_upem
from fontTools.unicodedata import script_extension
from fontTools.varLib import build as varlib_build
from fontTools.varLib import instancer

if TYPE_CHECKING:
    from collections.abc import Iterable, Mapping


def table(font: TTFont, tag: str) -> Any:
    """`font[tag]`, untyped: fontTools sets table fields when it decompiles
    them, so a type checker cannot see them.
    """
    return font[tag]


@dataclass(frozen=True)
class LineMetrics:
    """Vertical metrics in font units; `descender` is negative, `win_descent` not."""

    ascender: int
    descender: int
    line_gap: int
    win_ascent: int
    win_descent: int


@dataclass(frozen=True)
class WghtRange:
    minimum: float
    default: float
    maximum: float


def axis_range(font: TTFont, tag: str) -> WghtRange:
    for axis in font["fvar"].axes:
        if axis.axisTag == tag:
            return WghtRange(axis.minValue, axis.defaultValue, axis.maxValue)
    raise KeyError(tag)


def unmap_avar(segments: Mapping[float, float], value: float) -> float:
    """Inverts an avar segment map: normalized output coordinate to input."""
    points = sorted((mapped, original) for original, mapped in segments.items())
    for (a0, u0), (a1, u1) in pairwise(points):
        if a0 <= value <= a1:
            return u0 if a1 == a0 else u0 + (value - a0) * (u1 - u0) / (a1 - a0)
    return value


def denormalize(value: float, axis: WghtRange) -> float:
    span = (axis.default - axis.minimum) if value < 0 else (axis.maximum - axis.default)
    return axis.default + value * span


SNAP_TOLERANCE = 0.05


def snap(values: Iterable[float]) -> set[float]:
    """Rounds user-space breakpoints to whole units.

    Normalized coordinates are F2Dot14 and avar maps round-trip through it,
    so a design stop at 700 comes back as 699.99. A value further than
    SNAP_TOLERANCE from a whole unit is a real fractional stop and raises.
    """
    snapped = set()
    for value in values:
        whole = round(value)
        if abs(whole - value) >= SNAP_TOLERANCE:
            raise ValueError(f"wght breakpoint {value} is not near a whole unit")
        snapped.add(float(whole))
    return snapped


def wght_breakpoints(font: TTFont) -> set[float]:
    """User-space wght values where the font's wght interpolation is non-linear."""
    axis = axis_range(font, "wght")
    tags = [a.axisTag for a in font["fvar"].axes]
    wght_index = tags.index("wght")
    normalized: set[float] = {-1.0, 0.0, 1.0}
    for variations in font["gvar"].variations.values():
        for variation in variations:
            if "wght" in variation.axes:
                normalized.update(variation.axes["wght"])
    for tag in ("HVAR", "VVAR", "MVAR", "GDEF", "GPOS"):
        store = getattr(font[tag].table, "VarStore", None) if tag in font else None
        if store:
            for region in store.VarRegionList.Region:
                region_axis = region.VarRegionAxis[wght_index]
                normalized.update(
                    (
                        region_axis.StartCoord,
                        region_axis.PeakCoord,
                        region_axis.EndCoord,
                    )
                )
    segments = font["avar"].segments.get("wght") if "avar" in font else None
    if segments:
        normalized = {unmap_avar(segments, n) for n in normalized} | set(segments)
    return snap(denormalize(n, axis) for n in normalized)


def master_locations(breakpoints: Iterable[float], wght: WghtRange) -> list[float]:
    """Every breakpoint inside the range, plus its ends and default.

    The rebuilt font has no avar, so it only reproduces the inputs exactly if
    there is a master wherever either input's interpolation bends.
    """
    points = set(breakpoints) | {wght.minimum, wght.default, wght.maximum}
    return sorted(p for p in points if wght.minimum <= p <= wght.maximum)


def split_codepoints(latin: set[int], arabic: set[int]) -> tuple[set[int], set[int]]:
    """Arabic owns its Arabic-script codepoints and anything the Latin lacks.

    Shared punctuation, digits and spaces stay with the Latin font.
    """
    arabic_owned = {
        cp for cp in arabic if "Arab" in script_extension(chr(cp)) or cp not in latin
    }
    return latin - arabic_owned, arabic_owned


def derive_metrics(
    latin_typo: tuple[int, int],
    arabic_typo: tuple[int, int],
    scale: float,
    y_extent: tuple[float, float],
) -> LineMetrics:
    """One line box that holds both scripts' typo metrics, with win metrics
    widened to the ink extent (y_min, y_max) of every master so nothing clips.
    """
    ascender = max(latin_typo[0], round(arabic_typo[0] * scale))
    descender = min(latin_typo[1], round(arabic_typo[1] * scale))
    y_min, y_max = y_extent
    return LineMetrics(
        ascender=ascender,
        descender=descender,
        line_gap=0,
        win_ascent=max(ascender, round(y_max)),
        win_descent=max(-descender, -round(y_min)),
    )


def instance(font: TTFont, wght: float, pinned: Mapping[str, float]) -> TTFont:
    tags = {axis.axisTag for axis in font["fvar"].axes}
    location = {"wght": wght} | {k: v for k, v in pinned.items() if k in tags}
    return instancer.instantiateVariableFont(
        font, location, inplace=False, updateFontNames=False
    )


def _subset(font: TTFont, unicodes: set[int], scripts: list[str]) -> None:
    options = subset.Options(
        layout_features=["*"],
        layout_scripts=scripts,
        name_IDs=["*"],
        name_languages=["*"],
        name_legacy=True,
        glyph_names=True,
        notdef_outline=True,
        notdef_glyph=True,
        hinting=False,
        legacy_kern=True,
    )
    options.drop_tables += ["STAT", "gasp"]
    subsetter = subset.Subsetter(options)
    subsetter.populate(unicodes=unicodes)
    subsetter.subset(font)


def _to_buffer(font: TTFont) -> io.BytesIO:
    buffer = io.BytesIO()
    font.save(buffer)
    buffer.seek(0)
    return buffer


def make_master(
    latin_vf: TTFont,
    arabic_vf: TTFont,
    wght: float,
    scale: float,
    pinned: Mapping[str, float],
) -> TTFont:
    latin = instance(latin_vf, wght, pinned)
    arabic = instance(arabic_vf, wght, pinned)
    upem = table(latin, "head").unitsPerEm
    if abs(scale - 1) > 1e-6:
        scale_upem(arabic, round(upem * scale))
        table(arabic, "head").unitsPerEm = upem
    latin_cps, arabic_cps = split_codepoints(
        set(latin.getBestCmap() or {}), set(arabic.getBestCmap() or {})
    )
    _subset(latin, latin_cps, ["*"])
    # Noto Naskh also registers its Arabic lookups under DFLT and latn, which
    # would then apply to Latin runs.
    _subset(arabic, arabic_cps, ["arab"])
    merger = Merger(options=MergeOptions(drop_tables=["vmtx", "vhea"]))
    return merger.merge([_to_buffer(latin), _to_buffer(arabic)])


def y_extent(font: TTFont) -> tuple[float, float]:
    glyf = font["glyf"]
    y_min, y_max = 0.0, 0.0
    for name in font.getGlyphOrder():
        glyph = glyf[name]
        if glyph.numberOfContours == 0:
            continue
        glyph.recalcBounds(glyf)
        y_min, y_max = min(y_min, glyph.yMin), max(y_max, glyph.yMax)
    return y_min, y_max


def apply_metrics(font: TTFont, metrics: LineMetrics, latin_os2: Any) -> None:
    os2, hhea = table(font, "OS/2"), table(font, "hhea")
    os2.sTypoAscender = metrics.ascender
    os2.sTypoDescender = metrics.descender
    os2.sTypoLineGap = metrics.line_gap
    os2.usWinAscent, os2.usWinDescent = metrics.win_ascent, metrics.win_descent
    hhea.ascent, hhea.descent = metrics.ascender, metrics.descender
    hhea.lineGap = metrics.line_gap
    os2.sxHeight, os2.sCapHeight = latin_os2.sxHeight, latin_os2.sCapHeight
    if os2.version < 4:
        os2.version = 4


def build_variable(masters: Mapping[float, TTFont], wght: WghtRange) -> TTFont:
    doc = DesignSpaceDocument()
    axis = AxisDescriptor()
    axis.tag, axis.name = "wght", "Weight"
    axis.minimum, axis.default, axis.maximum = wght.minimum, wght.default, wght.maximum
    doc.addAxis(axis)
    for location, master in sorted(masters.items()):
        source = SourceDescriptor()
        source.font = master
        source.location = {"Weight": location}
        source.styleName = f"w{location:g}"
        doc.addSource(source)
    font, _, _ = varlib_build(doc, optimize=True)
    return font


@dataclass(frozen=True)
class MergeResult:
    font: TTFont
    masters: list[float]
    derived: LineMetrics


def merge_family(
    latin_vf: TTFont,
    arabic_vf: TTFont,
    *,
    scale: float,
    wght: WghtRange,
    pinned: Mapping[str, float],
    metrics: LineMetrics,
) -> MergeResult:
    """Builds the merged variable font with `metrics` applied to every master.

    Returns the metrics the inputs imply too, so the caller can hold the
    configured numbers to them.
    """
    locations = master_locations(
        wght_breakpoints(latin_vf) | wght_breakpoints(arabic_vf), wght
    )
    masters = {w: make_master(latin_vf, arabic_vf, w, scale, pinned) for w in locations}
    extents = [y_extent(m) for m in masters.values()]
    derived = derive_metrics(
        (table(latin_vf, "OS/2").sTypoAscender, table(latin_vf, "OS/2").sTypoDescender),
        (
            table(arabic_vf, "OS/2").sTypoAscender,
            table(arabic_vf, "OS/2").sTypoDescender,
        ),
        scale,
        (min(e[0] for e in extents), max(e[1] for e in extents)),
    )
    for master in masters.values():
        apply_metrics(master, metrics, table(latin_vf, "OS/2"))
    return MergeResult(build_variable(masters, wght), locations, derived)
