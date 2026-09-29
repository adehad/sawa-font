"""Glyph ink as flattened line edges, and the geometry of two inks side by side.

Fills use the nonzero winding rule, sampled on scanlines, so the answers are
exact along each sampled line and independent of any raster resolution.
"""

from __future__ import annotations

import math
from itertools import pairwise
from typing import TYPE_CHECKING, Literal

from fontTools.pens.basePen import BasePen

if TYPE_CHECKING:
    from collections.abc import Iterable, Mapping
    from typing import Any

Edge = tuple[float, float, float, float]
Box = tuple[float, float, float, float]
Side = Literal["top", "bottom"]

_CURVE_STEPS = 8


class EdgePen(BasePen):
    def __init__(self, glyphset: Mapping[str, Any] | None = None) -> None:
        super().__init__(glyphset)
        self.edges: list[Edge] = []
        self._start = (0.0, 0.0)
        self._last = (0.0, 0.0)

    def _line(self, pt: tuple[float, float]) -> None:
        self.edges.append((*self._last, *pt))
        self._last = pt

    def _moveTo(self, pt: tuple[float, float]) -> None:
        self._start = self._last = pt

    def _lineTo(self, pt: tuple[float, float]) -> None:
        self._line(pt)

    def _curve(self, points: list[tuple[float, float]]) -> None:
        for i in range(1, _CURVE_STEPS + 1):
            t = i / _CURVE_STEPS
            pts = points
            while len(pts) > 1:
                pts = [
                    (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
                    for a, b in pairwise(pts)
                ]
            self._line(pts[0])

    def _qCurveToOne(self, pt1: tuple[float, float], pt2: tuple[float, float]) -> None:
        self._curve([self._last, pt1, pt2])

    def _curveToOne(
        self,
        pt1: tuple[float, float],
        pt2: tuple[float, float],
        pt3: tuple[float, float],
    ) -> None:
        self._curve([self._last, pt1, pt2, pt3])

    def _closePath(self) -> None:
        if self._last != self._start:
            self._line(self._start)

    _endPath = _closePath


def glyph_edges(glyphset: Mapping[str, Any], glyph: str) -> list[Edge]:
    pen = EdgePen(glyphset)
    glyphset[glyph].draw(pen)
    return pen.edges


def moved(edges: Iterable[Edge], dx: float, dy: float) -> list[Edge]:
    return [(x0 + dx, y0 + dy, x1 + dx, y1 + dy) for x0, y0, x1, y1 in edges]


def box(edges: list[Edge]) -> Box | None:
    if not edges:
        return None
    xs = [v for e in edges for v in (e[0], e[2])]
    ys = [v for e in edges for v in (e[1], e[3])]
    return min(xs), min(ys), max(xs), max(ys)


def box_gap(a: Box, b: Box) -> float:
    dx = max(b[0] - a[2], a[0] - b[2], 0.0)
    dy = max(b[1] - a[3], a[1] - b[3], 0.0)
    return (dx * dx + dy * dy) ** 0.5


def scanlines(
    edges: Iterable[Edge], start: float, step: float, count: int
) -> list[list[tuple[float, float]]]:
    """The x intervals inside the outline along each line y = start + (k + 0.5)
    * step, for k in range(count).
    """
    crossings: list[list[tuple[float, int]]] = [[] for _ in range(count)]
    for x0, y0, x1, y1 in edges:
        if y0 == y1:
            continue
        low, high = (y0, y1) if y0 < y1 else (y1, y0)
        first = max(0, math.ceil((low - start) / step - 0.5))
        last = min(count, math.ceil((high - start) / step - 0.5))
        winding = 1 if y1 > y0 else -1
        slope = (x1 - x0) / (y1 - y0)
        for k in range(first, last):
            y = start + (k + 0.5) * step
            crossings[k].append((x0 + (y - y0) * slope, winding))
    result = []
    for row in crossings:
        row.sort()
        spans, winding, begin = [], 0, 0.0
        for x, turn in row:
            if winding == 0:
                begin = x
            winding += turn
            if winding == 0:
                spans.append((begin, x))
        result.append(spans)
    return result


def _transposed(edges: Iterable[Edge]) -> list[Edge]:
    return [(y0, x0, y1, x1) for x0, y0, x1, y1 in edges]


class Filled:
    """An outline's scanline spans on a fixed grid, computed once, for
    testing it against many other outlines.
    """

    def __init__(self, edges: list[Edge], step: float) -> None:
        self.edges = edges
        self.step = step
        self.box = box(edges)
        self.start = self.box[1] if self.box else 0.0
        count = math.ceil((self.box[3] - self.start) / step) if self.box else 0
        self.rows = scanlines(edges, self.start, step, count)

    def overlaps(self, other: list[Edge], tolerance: float) -> bool:
        """Whether `other` shares more than `tolerance` of any grid line."""
        other_box = box(other)
        if self.box is None or other_box is None:
            return False
        first = max(0, math.floor((other_box[1] - self.start) / self.step))
        last = min(len(self.rows), math.ceil((other_box[3] - self.start) / self.step))
        if last <= first:
            return False
        rows = scanlines(other, self.start + first * self.step, self.step, last - first)
        for mine, theirs in zip(self.rows[first:last], rows, strict=True):
            for a0, a1 in mine:
                for b0, b1 in theirs:
                    if min(a1, b1) - max(a0, b0) > tolerance:
                        return True
        return False


def overlap(a: list[Edge], b: list[Edge], step: float, tolerance: float) -> bool:
    """Whether two filled outlines share more than `tolerance` along any
    scanline, sampled every `step` units from the bottom of `a`.
    """
    return Filled(a, step).overlaps(b, tolerance)


def lift(
    base: list[Edge], mark: list[Edge], side: Side, clearance: float, step: float
) -> float:
    """How far to move `mark` away from `base` (up for top, down for bottom)
    so that it clears the base's ink by `clearance` in every column it spans,
    counting base ink up to `clearance` to either side of the column.
    """
    box_b, box_m = box(base), box(mark)
    if box_b is None or box_m is None:
        return 0.0
    reach = round(clearance / step)
    x0 = min(box_b[0], box_m[0])
    count = math.ceil((max(box_b[2], box_m[2]) - x0) / step)
    base_edge: list[float | None] = [
        (
            max(v for span in col for v in span)
            if side == "top"
            else min(v for span in col for v in span)
        )
        if col
        else None
        for col in scanlines(_transposed(base), x0, step, count)
    ]
    need = 0.0
    for k, col in enumerate(scanlines(_transposed(mark), x0, step, count)):
        if not col:
            continue
        near = [
            e for e in base_edge[max(0, k - reach) : k + reach + 1] if e is not None
        ]
        if not near:
            continue
        if side == "top":
            need = max(need, max(near) + clearance - min(v for s in col for v in s))
        else:
            need = max(need, max(v for s in col for v in s) - (min(near) - clearance))
    return need
