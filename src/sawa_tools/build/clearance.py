"""Ink-to-ink distances between placed glyphs, from sampled outlines.

An outline is flattened into boundary points about `step` units apart. The
distance between two inks is the least distance between their boundary
points, and zero when one ink lies inside the other, so it is exact to
about half a step.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from itertools import pairwise
from typing import TYPE_CHECKING, Any

import numpy as np
from fontTools.pens.basePen import BasePen

if TYPE_CHECKING:
    from collections.abc import Callable, Sequence

    from numpy.typing import NDArray

INF = math.inf

# Pairs of point sets compared per numpy block, to bound memory.
_BLOCK = 512


class SamplePen(BasePen):
    """Flattens outlines, as HarfBuzz or fontTools draws them, into boundary
    points about `step` units apart, contour by contour.
    """

    def __init__(self, step: float, glyphset: Any = None) -> None:
        super().__init__(glyphset)
        self.step = step
        self.contours: list[list[tuple[float, float]]] = []
        self._current: list[tuple[float, float]] = []
        self._last = (0.0, 0.0)
        self._start = (0.0, 0.0)

    def _moveTo(self, pt: tuple[float, float]) -> None:
        self._end()
        self._current = [pt]
        self._last = self._start = pt

    def _lineTo(self, pt: tuple[float, float]) -> None:
        x0, y0 = self._last
        n = max(1, int(math.hypot(pt[0] - x0, pt[1] - y0) / self.step))
        for i in range(1, n + 1):
            t = i / n
            self._current.append((x0 + (pt[0] - x0) * t, y0 + (pt[1] - y0) * t))
        self._last = pt

    def _bezier(self, points: list[tuple[float, float]]) -> None:
        n = max(2, int(sum(math.dist(a, b) for a, b in pairwise(points)) / self.step))
        for i in range(1, n + 1):
            t = i / n
            pts = points
            while len(pts) > 1:
                pts = [
                    (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
                    for a, b in pairwise(pts)
                ]
            self._current.append(pts[0])
        self._last = points[-1]

    def _qCurveToOne(self, pt1: tuple[float, float], pt2: tuple[float, float]) -> None:
        self._bezier([self._last, pt1, pt2])

    def _curveToOne(
        self,
        pt1: tuple[float, float],
        pt2: tuple[float, float],
        pt3: tuple[float, float],
    ) -> None:
        self._bezier([self._last, pt1, pt2, pt3])

    def _closePath(self) -> None:
        if self._last != self._start:
            self._lineTo(self._start)
        self._end()

    _endPath = _closePath

    def _end(self) -> None:
        if len(self._current) > 1:
            self.contours.append(self._current)
        self._current = []


@dataclass(frozen=True)
class Ink:
    """A glyph's boundary samples at its own origin."""

    points: NDArray[np.float64]
    contours: tuple[NDArray[np.float64], ...]
    box: tuple[float, float, float, float] | None

    @classmethod
    def drawn(
        cls, draw: Callable[[Any], None], step: float, glyphset: Any = None
    ) -> Ink:
        """The ink `draw` draws on a pen; `glyphset` resolves components."""
        pen = SamplePen(step, glyphset)
        draw(pen)
        pen._end()
        contours = tuple(np.asarray(c, dtype=np.float64) for c in pen.contours)
        if not contours:
            return cls(np.zeros((0, 2)), (), None)
        points = np.concatenate(contours)
        low, high = points.min(0), points.max(0)
        return cls(points, contours, (float(low[0]), float(low[1]), high[0], high[1]))

    def __bool__(self) -> bool:
        return self.box is not None


def moved(points: NDArray[np.float64], dx: float, dy: float) -> NDArray[np.float64]:
    return points + np.array([dx, dy])


def boxes_apart(
    a: tuple[float, float, float, float],
    b: tuple[float, float, float, float],
    limit: float,
) -> bool:
    """Whether two boxes are further than `limit` apart on some axis."""
    return (
        b[0] > a[2] + limit
        or b[2] < a[0] - limit
        or b[1] > a[3] + limit
        or b[3] < a[1] - limit
    )


def _inside(
    point: NDArray[np.float64], contours: Sequence[NDArray[np.float64]]
) -> bool:
    """Whether `point` is inside the nonzero fill of `contours`."""
    x, y = float(point[0]), float(point[1])
    winding = 0
    for c in contours:
        x0, y0 = c[:, 0], c[:, 1]
        x1, y1 = np.roll(x0, -1), np.roll(y0, -1)
        up = (y0 <= y) & (y1 > y)
        down = (y0 > y) & (y1 <= y)
        cross = up | down
        if not cross.any():
            continue
        t = (y - y0[cross]) / (y1[cross] - y0[cross])
        xc = x0[cross] + t * (x1[cross] - x0[cross])
        right = xc > x
        winding += int(np.sum(right & up[cross])) - int(np.sum(right & down[cross]))
    return winding != 0


def distance(
    a: Ink,
    b: Ink,
    offset: tuple[float, float],
    limit: float,
) -> float:
    """The ink distance from `a` at the origin to `b` moved by `offset`,
    `limit` or more when they are at least `limit` apart.
    """
    if a.box is None or b.box is None:
        return INF
    dx, dy = offset
    bb = (b.box[0] + dx, b.box[1] + dy, b.box[2] + dx, b.box[3] + dy)
    if boxes_apart(a.box, bb, limit):
        return INF
    lo = np.array([max(a.box[0], bb[0]) - limit, max(a.box[1], bb[1]) - limit])
    hi = np.array([min(a.box[2], bb[2]) + limit, min(a.box[3], bb[3]) + limit])
    p = a.points[np.all((a.points >= lo) & (a.points <= hi), axis=1)]
    q = moved(b.points, dx, dy)
    q = q[np.all((q >= lo) & (q <= hi), axis=1)]
    best = INF
    if len(p) and len(q):
        for i in range(0, len(p), _BLOCK):
            d = ((p[i : i + _BLOCK, None, :] - q[None, :, :]) ** 2).sum(-1)
            best = min(best, float(d.min()))
        best = math.sqrt(best)
    if best < limit:
        return best
    # Boundaries apart but boxes overlapping: one ink may hold the other.
    if (
        a.box[0] <= bb[2]
        and bb[0] <= a.box[2]
        and a.box[1] <= bb[3]
        and bb[1] <= a.box[3]
    ):
        shifted = tuple(moved(c, dx, dy) for c in b.contours)
        if _inside(moved(b.points[:1], dx, dy)[0], a.contours) or _inside(
            a.points[0], shifted
        ):
            return 0.0
    return best


def _column_extremes(points: NDArray[np.float64], width: float) -> NDArray[np.float64]:
    """The lowest and highest sample in each column `width` wide: a vertical
    move meets ink first with one of them.
    """
    columns = np.floor(points[:, 0] / width).astype(np.int64)
    order = np.lexsort((points[:, 1], columns))
    ordered, cols = points[order], columns[order]
    first = np.r_[True, cols[1:] != cols[:-1]]
    last = np.r_[cols[1:] != cols[:-1], True]
    return np.concatenate([ordered[first], ordered[last]])


def approach(
    mover: NDArray[np.float64],
    obstacle: NDArray[np.float64],
    gap: float,
    direction: int,
) -> float:
    """How far `mover` can move vertically towards `obstacle` (direction -1:
    down onto ink below it, +1: up onto ink above it) and keep every pair of
    samples `gap` apart; INF when no ink is in its way. Ink behind the
    mover, such as an arm it sits under, does not limit a move towards the
    obstacle. When the two are already closer than `gap`, the result is
    negative: minus the shortest move away after which every sample pair
    is `gap` apart again, which may carry the mover past ink behind it.
    """
    if not len(mover) or not len(obstacle):
        return INF
    mover = _column_extremes(mover, gap / 8)
    near_x = (obstacle[:, 0] >= mover[:, 0].min() - gap) & (
        obstacle[:, 0] <= mover[:, 0].max() + gap
    )
    q = obstacle[near_x]
    if not len(q):
        return INF
    room = INF
    lows, highs = [], []
    for i in range(0, len(mover), _BLOCK):
        p = mover[i : i + _BLOCK]
        dx = p[:, 0, None] - q[None, :, 0]
        # Positive when the obstacle point is in the direction of travel.
        dy = direction * (q[None, :, 1] - p[:, 1, None])
        near = np.abs(dx) < gap
        if not near.any():
            continue
        need = np.sqrt(np.maximum(gap * gap - dx**2, 0.0))
        ahead = near & (dy > -need)
        if ahead.any():
            room = min(room, float((dy - need)[ahead].min()))
        # A move away by m leaves this pair too close for m in (low, high).
        lows.append((-need - dy)[near])
        highs.append((need - dy)[near])
    if room >= 0:
        return room
    low, high = np.concatenate(lows), np.concatenate(highs)
    move = 0.0
    while True:
        inside = (low < move) & (move < high)
        if not inside.any():
            return -move
        move = float(high[inside].max())
