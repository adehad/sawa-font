"""Finds where two SVG layers differ, as bounding boxes in SVG units.

Both layers are rasterised over the union of their viewBoxes (they share an
origin and baseline, see render.py), XORed, dilated so nearby differences
merge into one region, and split into 8-connected components. Changed
specks under a few pixels, such as a curve's edge moving by a rounding
step, are dropped before dilation.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

import numpy as np

from sawa_tools.report.raster import parse_viewbox, rasterise, svg_edges
from sawa_tools.report.render import ViewBox

if TYPE_CHECKING:
    from numpy.typing import NDArray

DEFAULT_SCALE = 2.0
DEFAULT_DILATE = 4
DEFAULT_MIN_PIXELS = 4


@dataclass(frozen=True)
class Region:
    x: float
    y: float
    width: float
    height: float

    def as_dict(self) -> dict[str, float]:
        return {
            "x": self.x,
            "y": self.y,
            "width": self.width,
            "height": self.height,
        }


def union_viewbox(a: ViewBox, b: ViewBox) -> ViewBox:
    x0, y0 = min(a.x, b.x), min(a.y, b.y)
    x1 = max(a.x + a.width, b.x + b.width)
    y1 = max(a.y + a.height, b.y + b.height)
    return ViewBox(x0, y0, x1 - x0, y1 - y0)


def _dilate_rows(mask: NDArray[np.bool_], radius: int) -> NDArray[np.bool_]:
    n = mask.shape[1]
    csum = np.zeros((mask.shape[0], n + 1), dtype=np.int32)
    np.cumsum(mask, axis=1, out=csum[:, 1:])
    idx = np.arange(n)
    hi = np.minimum(idx + radius + 1, n)
    lo = np.maximum(idx - radius, 0)
    return (csum[:, hi] - csum[:, lo]) > 0


def dilate(mask: NDArray[np.bool_], radius: int) -> NDArray[np.bool_]:
    """Square-kernel binary dilation."""
    if radius <= 0:
        return mask
    return _dilate_rows(_dilate_rows(mask, radius).T, radius).T


def _row_runs(row: NDArray[np.bool_]) -> list[tuple[int, int]]:
    padded = np.concatenate([[False], row, [False]]).astype(np.int8)
    edges = np.flatnonzero(np.diff(padded))
    return list(zip(edges[::2].tolist(), edges[1::2].tolist(), strict=True))


@dataclass(frozen=True)
class Component:
    box: tuple[int, int, int, int]
    """(col0, row0, col1, row1), ends exclusive."""
    pixels: int
    runs: list[tuple[int, int, int]]
    """(row, col0, col1) of every run in the component."""


def components(mask: NDArray[np.bool_]) -> list[Component]:
    """The 8-connected components of `mask`, found by union-find over row
    runs, sorted by bounding box.
    """
    parent: list[int] = []
    runs: list[tuple[int, int, int]] = []

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    previous: list[tuple[int, int, int]] = []
    for r in range(mask.shape[0]):
        current: list[tuple[int, int, int]] = []
        for c0, c1 in _row_runs(mask[r]):
            label = len(parent)
            parent.append(label)
            runs.append((r, c0, c1))
            for p0, p1, other in previous:
                if p0 <= c1 and c0 <= p1:
                    a, b = find(label), find(other)
                    if a != b:
                        parent[b] = a
            current.append((c0, c1, label))
        previous = current
    grouped: dict[int, list[tuple[int, int, int]]] = {}
    for label, run in enumerate(runs):
        grouped.setdefault(find(label), []).append(run)
    result = [
        Component(
            box=(
                min(c0 for _, c0, _ in members),
                min(r for r, _, _ in members),
                max(c1 for _, _, c1 in members),
                max(r for r, _, _ in members) + 1,
            ),
            pixels=sum(c1 - c0 for _, c0, c1 in members),
            runs=members,
        )
        for members in grouped.values()
    ]
    return sorted(result, key=lambda c: c.box)


def drop_specks(mask: NDArray[np.bool_], min_pixels: int) -> NDArray[np.bool_]:
    """`mask` without components of fewer than `min_pixels` pixels."""
    out = mask.copy()
    for component in components(mask):
        if component.pixels < min_pixels:
            for r, c0, c1 in component.runs:
                out[r, c0:c1] = False
    return out


def diff_regions(
    current_svg: str,
    baseline_svg: str,
    scale: float = DEFAULT_SCALE,
    radius: int = DEFAULT_DILATE,
    min_pixels: int = DEFAULT_MIN_PIXELS,
) -> list[Region]:
    """Changed areas, ignoring slivers under `min_pixels` raster pixels."""
    box = union_viewbox(parse_viewbox(current_svg), parse_viewbox(baseline_svg))
    a = rasterise(svg_edges(current_svg), box, scale)
    b = rasterise(svg_edges(baseline_svg), box, scale)
    changed = drop_specks(a ^ b, min_pixels)
    if not changed.any():
        return []
    regions = []
    for component in components(dilate(changed, radius)):
        c0, r0, c1, r1 = component.box
        regions.append(
            Region(
                round(box.x + c0 / scale, 2),
                round(box.y + r0 / scale, 2),
                round((c1 - c0) / scale, 2),
                round((r1 - r0) / scale, 2),
            )
        )
    return regions
