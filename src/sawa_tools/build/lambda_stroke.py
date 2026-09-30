"""Adds U+A7DC LATIN CAPITAL LETTER LAMBDA WITH STROKE, per static master.

The sources have ƛ (U+019B), the small letter, but not its capital, so
case mapping has nothing to map it to. The capital is Λ (U+039B) with one
straight stroke across its long right leg: centred at 0.55 of Λ's height,
at the angle of ƛ's own stroke, overshooting the leg on each side by as much
of a stem as ƛ's overshoots λ's, and as thick as Ł's stroke over L, but no
thinner than L's stem. Where ƛ draws its stroke as a contour of its own (as
Cascadia does) the angle is that contour's; where the stroke is part of the
letter's outline (as in Noto), it is fitted through the points where ƛ's
outline leaves λ's. Angle and overshoot are measured on the default master
and shared by all, so that the stroke only moves and thickens between them.
The glyph is Λ's outline, decomposed, plus the stroke, at Λ's advance.
"""

from __future__ import annotations

import math
from collections import Counter
from dataclasses import astuple, dataclass
from typing import TYPE_CHECKING, Any

from fontTools.pens.basePen import decomposeQuadraticSegment
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.recordingPen import DecomposingRecordingPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib.tables._g_l_y_f import flagOverlapSimple

if TYPE_CHECKING:
    from collections.abc import Mapping, Sequence

    from fontTools.ttLib import TTFont

CODEPOINT = 0xA7DC
NAME = "uniA7DC"
CENTRE = 0.55
CAPITAL, SMALL, STROKED = 0x039B, 0x03BB, 0x019B
L, LSLASH = 0x004C, 0x0141
_BASE_GLYPH_CLASS = 1

Point = tuple[float, float]


class StrokeError(Exception):
    """Raised when a master lacks a glyph the stroke is measured on, or the
    measurement finds no stroke.
    """


def _table(font: TTFont, tag: str) -> Any:
    return font[tag]


def _contours(glyphset: Mapping[str, Any], glyph: str) -> list[list[tuple]]:
    """Each contour of `glyph`, decomposed, as ("line", p0, p1) and
    ("quad", p0, control, p1) segments.
    """
    pen = DecomposingRecordingPen(glyphset)
    glyphset[glyph].draw(pen)
    contours: list[list[tuple]] = []
    current: list[tuple] = []
    start = last = (0.0, 0.0)
    for op, args in pen.value:
        if op == "moveTo":
            start = last = args[0]
        elif op == "lineTo":
            current.append(("line", last, args[0]))
            last = args[0]
        elif op == "qCurveTo":
            points = list(args)
            if points[-1] is None:
                # A contour of off-curve points only: it starts and ends
                # halfway between its last and first points.
                (x0, y0), (x1, y1) = points[-2], points[0]
                start = last = ((x0 + x1) / 2, (y0 + y1) / 2)
                points[-1] = start
            if len(points) == 1:
                current.append(("line", last, points[0]))
                last = points[0]
                continue
            for control, end in decomposeQuadraticSegment(points):
                current.append(("quad", last, control, end))
                last = end
        elif op in ("closePath", "endPath"):
            if current:
                contours.append(current)
            current = []
    return contours


def _crossings(segment: tuple, y: float) -> list[float]:
    if segment[0] == "line":
        (x0, y0), (x1, y1) = segment[1], segment[2]
        if y0 == y1:
            return []
        t = (y - y0) / (y1 - y0)
        return [x0 + t * (x1 - x0)] if 0 <= t <= 1 else []
    (x0, y0), (cx, cy), (x1, y1) = segment[1], segment[2], segment[3]
    a, b, c = y0 - 2 * cy + y1, 2 * (cy - y0), y0 - y
    if abs(a) < 1e-9:
        roots = [] if abs(b) < 1e-9 else [-c / b]
    else:
        disc = b * b - 4 * a * c
        roots = (
            [] if disc < 0 else [(-b + s * math.sqrt(disc)) / (2 * a) for s in (1, -1)]
        )
    return [
        (1 - t) ** 2 * x0 + 2 * (1 - t) * t * cx + t * t * x1
        for t in roots
        if 0 <= t <= 1
    ]


class _Glyphs:
    """One master's glyphs by codepoint, with their outline crossings."""

    def __init__(self, font: TTFont) -> None:
        self.font = font
        self.glyphset = font.getGlyphSet()
        cmap = font.getBestCmap() or {}
        self.names = {}
        for cp in (CAPITAL, SMALL, STROKED, L, LSLASH):
            if cp not in cmap:
                raise StrokeError(f"the master has no U+{cp:04X}")
            self.names[cp] = cmap[cp]
        self._contours: dict[int, list[list[tuple]]] = {}

    def contours(self, cp: int) -> list[list[tuple]]:
        if cp not in self._contours:
            self._contours[cp] = _contours(self.glyphset, self.names[cp])
        return self._contours[cp]

    def xs(self, cp: int, y: float) -> list[float]:
        """Where the line at height `y` crosses the outline, sorted."""
        return sorted(
            x
            for contour in self.contours(cp)
            for s in contour
            for x in _crossings(s, y)
        )

    def width(self, cp: int, y: float) -> float:
        xs = self.xs(cp, y)
        return xs[-1] - xs[0] if len(xs) >= 2 else 0.0

    def bounds(self, cp: int) -> tuple[float, float, float, float]:
        pen = BoundsPen(self.glyphset)
        self.glyphset[self.names[cp]].draw(pen)
        if pen.bounds is None:
            raise StrokeError(f"U+{cp:04X} has no ink")
        return pen.bounds

    def points(self, cp: int) -> list[list[Point]]:
        """The on- and off-curve points of each contour, decomposed."""
        glyf = _table(self.font, "glyf")
        coords, ends, _ = glyf[self.names[cp]].getCoordinates(glyf)
        contours, start = [], 0
        for end in ends:
            contours.append([tuple(p) for p in coords[start : end + 1]])
            start = end + 1
        return contours


def _axis(points: Sequence[Point]) -> tuple[float, float]:
    """(thickness, angle) of a bar through `points`: the angle of their
    principal axis and their spread across it.
    """
    n = len(points)
    mx = sum(p[0] for p in points) / n
    my = sum(p[1] for p in points) / n
    sxx = sum((p[0] - mx) ** 2 for p in points) / n
    syy = sum((p[1] - my) ** 2 for p in points) / n
    sxy = sum((p[0] - mx) * (p[1] - my) for p in points) / n
    theta = 0.5 * math.atan2(2 * sxy, sxx - syy)
    nx, ny = -math.sin(theta), math.cos(theta)
    across = [(p[0] - mx) * nx + (p[1] - my) * ny for p in points]
    return max(across) - min(across), theta


def _height(points: Sequence[Point]) -> float:
    ys = [p[1] for p in points]
    return max(ys) - min(ys)


def _separate_stroke(glyphs: _Glyphs, base: int, stroked: int) -> list[Point] | None:
    """The points of the contours `stroked` has beyond `base`'s, matched by
    height; None when both have as many contours.
    """
    base_contours, stroked_contours = glyphs.points(base), glyphs.points(stroked)
    if len(stroked_contours) <= len(base_contours):
        return None
    remaining = list(stroked_contours)
    for contour in base_contours:
        match = min(remaining, key=lambda c: abs(_height(c) - _height(contour)))
        remaining.remove(match)
    return [p for c in remaining for p in c]


def _stem(glyphs: _Glyphs) -> float:
    """L's stem: its narrowest width between 0.3 and 0.7 of its height."""
    _, y0, _, y1 = glyphs.bounds(L)
    widths = [glyphs.width(L, y0 + (y1 - y0) * f) for f in (0.3, 0.4, 0.5, 0.6, 0.7)]
    return min(w for w in widths if w > 0)


def _crossing_band(glyphs: _Glyphs, samples: int = 300) -> tuple[float, float, float]:
    """(bottom, top, peak) of the heights where ƛ's outline is widest beyond
    λ's, at 0.4 of the widest or more; the outer 5% of λ's height is left
    out, where a tapering tip would read as a difference.
    """
    _, y0, _, y1 = glyphs.bounds(SMALL)
    margin = 0.05 * (y1 - y0)
    y0, y1 = y0 + margin, y1 - margin
    ys = [y0 + (y1 - y0) * i / samples for i in range(1, samples)]
    diffs = [abs(glyphs.width(STROKED, y) - glyphs.width(SMALL, y)) for y in ys]
    peak = max(diffs)
    if peak <= 0:
        raise StrokeError("U+019B is as wide as U+03BB everywhere")
    top = bottom = diffs.index(peak)
    while bottom > 0 and diffs[bottom - 1] >= 0.4 * peak:
        bottom -= 1
    while top < len(diffs) - 1 and diffs[top + 1] >= 0.4 * peak:
        top += 1
    return ys[bottom], ys[top], ys[diffs.index(peak)]


def _outermost(glyphs: _Glyphs, y: float) -> Point | None:
    """Where ƛ's outline reaches furthest beyond λ's at `y`, on whichever
    side reaches further.
    """
    small, stroked = glyphs.xs(SMALL, y), glyphs.xs(STROKED, y)
    if len(small) < 2 or len(stroked) < 2:
        return None
    left, right = small[0] - stroked[0], stroked[-1] - small[-1]
    return (stroked[0], y) if left >= right else (stroked[-1], y)


def _fused_angle(
    glyphs: _Glyphs, bottom: float, top: float, samples: int = 15
) -> float:
    """The angle of a line through `_outermost` across the band; many
    samples keep a short end of the stroke from setting it.
    """
    points = [
        p
        for i in range(samples)
        if (p := _outermost(glyphs, bottom + (top - bottom) * i / (samples - 1)))
    ]
    if len(points) < 2:
        raise StrokeError("U+019B's stroke leaves U+03BB's outline nowhere")
    return _axis(points)[1]


def _overshoots(glyphs: _Glyphs, y: float, stem: float) -> tuple[float, float]:
    """How far ƛ's stroke reaches beyond λ at `y`, left and right, in stems."""
    small, stroked = glyphs.xs(SMALL, y), glyphs.xs(STROKED, y)
    return (small[0] - stroked[0]) / stem, (stroked[-1] - small[-1]) / stem


def _lslash_stroke(glyphs: _Glyphs) -> list[Point]:
    """The points Ł has that L lacks. Where the stroke is part of the
    outline, Ł's letter can sit shifted from L's; the most common offset
    between points of equal height is taken as that shift first.
    """
    separate = _separate_stroke(glyphs, L, LSLASH)
    if separate is not None:
        return separate
    plain = [p for c in glyphs.points(L) for p in c]
    slashed = [p for c in glyphs.points(LSLASH) for p in c]
    shifts = Counter(
        (round(p[0] - q[0]), round(p[1] - q[1]))
        for p in slashed
        for q in plain
        if abs(p[1] - q[1]) <= 6
    )
    dx, dy = shifts.most_common(1)[0][0] if shifts else (0, 0)
    moved = [(q[0] + dx, q[1] + dy) for q in plain]
    new = [
        p
        for p in slashed
        if all(abs(p[0] - q[0]) > 6 or abs(p[1] - q[1]) > 6 for q in moved)
    ]
    if not new:
        raise StrokeError("U+0141 has no points U+004C lacks")
    return new


@dataclass(frozen=True)
class Shape:
    """The stroke's angle, in radians, and how far it reaches past the leg
    on each side, in stems.
    """

    angle: float
    left: float
    right: float


def shape(font: TTFont) -> Shape:
    """The stroke's shape, measured on ƛ against λ."""
    glyphs = _Glyphs(font)
    stem = _stem(glyphs)
    separate = _separate_stroke(glyphs, SMALL, STROKED)
    if separate is not None:
        ys = [p[1] for p in separate]
        left, right = _overshoots(glyphs, (min(ys) + max(ys)) / 2, stem)
        return Shape(_axis(separate)[1], left, right)
    bottom, top, peak = _crossing_band(glyphs)
    left, right = _overshoots(glyphs, peak, stem)
    return Shape(_fused_angle(glyphs, bottom, top), left, right)


def stroke(font: TTFont, form: Shape | None = None) -> list[Point]:
    """The four corners of the stroke across Λ's right leg, clockwise, of
    `form`, or of the shape measured on `font` itself.
    """
    glyphs = _Glyphs(font)
    stem = _stem(glyphs)
    angle, left, right = astuple(form or shape(font))
    thickness = max(_axis(_lslash_stroke(glyphs))[0], stem)
    _, y0, _, y1 = glyphs.bounds(CAPITAL)
    y = y0 + CENTRE * (y1 - y0)
    xs = glyphs.xs(CAPITAL, y)
    if len(xs) < 2:
        raise StrokeError(f"U+039B's outline does not cross y={y:g}")
    x = xs[-1] - stem / 2
    length = stem * (1 + left + right)
    ux, uy = math.cos(angle), math.sin(angle)
    nx, ny = -uy * thickness / 2, ux * thickness / 2
    ax, ay = x - ux * length / 2, y - uy * length / 2
    bx, by = x + ux * length / 2, y + uy * length / 2
    corners = [
        (ax + nx, ay + ny),
        (bx + nx, by + ny),
        (bx - nx, by - ny),
        (ax - nx, ay - ny),
    ]
    area = sum(
        p[0] * q[1] - q[0] * p[1]
        for p, q in zip(corners, corners[1:] + corners[:1], strict=True)
    )
    return corners[::-1] if area > 0 else corners


def add_capital_lambda_with_stroke(
    masters: Mapping[float, TTFont], default: float
) -> str | None:
    """Adds U+A7DC to every master, its stroke shaped as ƛ's on the default
    master (on a heavy master, where ƛ's stroke merges into the letter, the
    measured angle is unreliable); returns its glyph, or None if the masters
    already map it.
    """
    if CODEPOINT in (masters[default].getBestCmap() or {}):
        return None
    form = shape(masters[default])
    for font in masters.values():
        _add(font, form)
    return NAME


def _add(font: TTFont, form: Shape) -> None:
    order = font.getGlyphOrder()
    if NAME in order:
        raise StrokeError(f"the master already has a glyph named {NAME!r}")
    corners = stroke(font, form)
    capital = (font.getBestCmap() or {})[CAPITAL]
    pen = TTGlyphPen(None)
    recording = DecomposingRecordingPen(font.getGlyphSet())
    font.getGlyphSet()[capital].draw(recording)
    recording.replay(pen)
    pen.moveTo(_rounded(corners[0]))
    for corner in corners[1:]:
        pen.lineTo(_rounded(corner))
    pen.closePath()
    glyph = pen.glyph()
    glyph.flags[0] |= flagOverlapSimple
    font.setGlyphOrder([*order, NAME])
    glyf = _table(font, "glyf")
    glyf.glyphOrder = font.getGlyphOrder()
    glyf[NAME] = glyph
    glyph.recalcBounds(glyf)
    hmtx = _table(font, "hmtx")
    hmtx.metrics[NAME] = (hmtx[capital][0], glyph.xMin)
    for subtable in _table(font, "cmap").tables:
        if subtable.isUnicode():
            subtable.cmap[CODEPOINT] = NAME
    _table(font, "GDEF").table.GlyphClassDef.classDefs[NAME] = _BASE_GLYPH_CLASS


def _rounded(point: Point) -> tuple[int, int]:
    return round(point[0]), round(point[1])
