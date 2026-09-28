"""Rasterises the report's own SVG layers to boolean masks.

Parses only what render.py writes: absolute M, L, Q, C and Z commands in
`<path d>` attributes and the root viewBox. Curves are flattened to lines
and filled with the nonzero winding rule, sampled at pixel centres, so the
same path data always gives the same mask.
"""

from __future__ import annotations

import math
import re
from itertools import pairwise
from typing import TYPE_CHECKING

import numpy as np

from sawa_tools.report.render import ViewBox

if TYPE_CHECKING:
    from numpy.typing import NDArray

_VIEWBOX_RE = re.compile(r'<svg\b[^>]*\bviewBox="([^"]+)"')
_PATH_RE = re.compile(r'<path\b[^>]*\bd="([^"]*)"')
_TOKEN_RE = re.compile(r"[MLQCZ]|-?\d+(?:\.\d+)?")
_ARITY = {"M": 2, "L": 2, "Q": 4, "C": 6, "Z": 0}
_CURVE_STEPS = 8

Point = tuple[float, float]
Edge = tuple[float, float, float, float]


class RasterError(Exception):
    """Raised for SVG content this rasteriser does not understand."""


def parse_viewbox(svg: str) -> ViewBox:
    match = _VIEWBOX_RE.search(svg)
    if not match:
        raise RasterError("SVG has no viewBox")
    x, y, width, height = (float(v) for v in match.group(1).split())
    return ViewBox(x, y, width, height)


def _bezier(points: list[Point], steps: int) -> list[Point]:
    out = []
    for i in range(1, steps + 1):
        t = i / steps
        pts = points
        while len(pts) > 1:
            pts = [
                (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
                for a, b in pairwise(pts)
            ]
        out.append(pts[0])
    return out


def path_edges(d: str) -> list[Edge]:
    """Flattened, implicitly closed contours of one path as line edges."""
    tokens = _TOKEN_RE.findall(d)
    edges: list[Edge] = []
    start: Point | None = None
    current: Point | None = None
    i = 0

    def close() -> None:
        if start is not None and current is not None and current != start:
            edges.append((*current, *start))

    while i < len(tokens):
        cmd = tokens[i]
        if cmd not in _ARITY:
            raise RasterError(f"unexpected token {cmd!r} in path data")
        args = [float(v) for v in tokens[i + 1 : i + 1 + _ARITY[cmd]]]
        i += 1 + _ARITY[cmd]
        if cmd == "M":
            close()
            start = current = (args[0], args[1])
            continue
        if current is None:
            raise RasterError(f"path command {cmd} before any M")
        if cmd == "Z":
            close()
            current = start
            continue
        pts = [(args[j], args[j + 1]) for j in range(0, len(args), 2)]
        line = pts if cmd == "L" else _bezier([current, *pts], _CURVE_STEPS)
        for point in line:
            edges.append((*current, *point))
            current = point
    close()
    return edges


def svg_edges(svg: str) -> list[Edge]:
    return [edge for d in _PATH_RE.findall(svg) for edge in path_edges(d)]


def rasterise(edges: list[Edge], box: ViewBox, scale: float) -> NDArray[np.bool_]:
    """Nonzero-winding mask of `edges` over `box`, `scale` pixels per unit."""
    width = math.ceil(box.width * scale)
    height = math.ceil(box.height * scale)
    mask = np.zeros((height, width), dtype=bool)
    if not edges or width == 0 or height == 0:
        return mask
    e = np.asarray(edges, dtype=np.float64)
    x0 = (e[:, 0] - box.x) * scale
    y0 = (e[:, 1] - box.y) * scale
    x1 = (e[:, 2] - box.x) * scale
    y1 = (e[:, 3] - box.y) * scale
    winding = np.where(y1 > y0, 1, -1)
    lo = np.minimum(y0, y1)
    hi = np.maximum(y0, y1)
    # Rows whose centre (row + 0.5) lies in [lo, hi).
    first = np.clip(np.ceil(lo - 0.5), 0, height).astype(np.int64)
    last = np.clip(np.ceil(hi - 0.5), 0, height).astype(np.int64)
    counts = last - first
    keep = counts > 0
    if not keep.any():
        return mask
    idx = np.repeat(np.nonzero(keep)[0], counts[keep])
    offsets = np.arange(idx.size) - np.repeat(
        np.cumsum(counts[keep]) - counts[keep], counts[keep]
    )
    rows = first[idx] + offsets
    yc = rows + 0.5
    t = (yc - y0[idx]) / (y1[idx] - y0[idx])
    xc = x0[idx] + t * (x1[idx] - x0[idx])
    cols = np.clip(np.ceil(xc - 0.5), 0, width).astype(np.int64)
    acc = np.zeros((height, width + 1), dtype=np.int32)
    np.add.at(acc, (rows, cols), winding[idx])
    return np.cumsum(acc, axis=1)[:, :width] != 0
