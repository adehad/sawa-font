"""Renders a shaped line to an SVG layer.

SVG coordinates put the pen's start at x = 0 and the baseline at y = 0,
with y growing downwards, so every layer of a test shares its origin and
baseline and only the viewBox has to be agreed between them.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import TYPE_CHECKING
from xml.sax.saxutils import escape

from fontTools.pens.basePen import BasePen

from sawa_tools.report.shape import FontStack

if TYPE_CHECKING:
    from pathlib import Path

    from sawa_tools.report.shape import Glyph, LineMetrics


@dataclass(frozen=True)
class ViewBox:
    x: float
    y: float
    width: float
    height: float

    def attr(self) -> str:
        return " ".join(_num(v) for v in (self.x, self.y, self.width, self.height))

    def as_list(self) -> list[float]:
        return [self.x, self.y, self.width, self.height]


@dataclass(frozen=True)
class Bounds:
    x_min: float
    y_min: float
    x_max: float
    y_max: float

    def union(self, other: Bounds) -> Bounds:
        return Bounds(
            min(self.x_min, other.x_min),
            min(self.y_min, other.y_min),
            max(self.x_max, other.x_max),
            max(self.y_max, other.y_max),
        )


@dataclass(frozen=True)
class Layout:
    path: str
    advance: float
    ink: Bounds | None
    metrics: LineMetrics
    scale: float
    glyphs: list[Glyph]

    @property
    def extent(self) -> Bounds:
        """Ink plus the pen's travel and the line box, in SVG units."""
        box = Bounds(
            0.0,
            -self.metrics.ascender * self.scale,
            self.advance,
            -self.metrics.descender * self.scale,
        )
        return box if self.ink is None else box.union(self.ink)

    def guides(self) -> dict[str, float | None]:
        m, s = self.metrics, self.scale

        def y(value: int | None) -> float | None:
            return None if value is None else _round(-value * s)

        return {
            "ascender": y(m.ascender),
            "capHeight": y(m.cap_height),
            "xHeight": y(m.x_height),
            "baseline": 0.0,
            "descender": y(m.descender),
            "lineBoxTop": y(m.ascender + m.line_gap // 2),
            "lineBoxBottom": y(m.descender - (m.line_gap - m.line_gap // 2)),
        }


def _round(value: float) -> float:
    return round(value, 2) + 0.0


def _num(value: float) -> str:
    text = f"{_round(value):.2f}".rstrip("0").rstrip(".")
    return "0" if text in ("", "-0") else text


class _SVGPen(BasePen):
    """Records absolute M/L/Q/C/Z commands in SVG units."""

    def __init__(self, scale: float) -> None:
        super().__init__(None)
        self.scale = scale
        self.dx = 0.0
        self.dy = 0.0
        self.commands: list[str] = []
        self.xs: list[float] = []
        self.ys: list[float] = []

    def _pt(self, pt: tuple[float, float]) -> str:
        x = self.dx + pt[0] * self.scale
        y = self.dy - pt[1] * self.scale
        self.xs.append(x)
        self.ys.append(y)
        return f"{_num(x)} {_num(y)}"

    def _moveTo(self, pt: tuple[float, float]) -> None:
        self.commands.append("M" + self._pt(pt))

    def _lineTo(self, pt: tuple[float, float]) -> None:
        self.commands.append("L" + self._pt(pt))

    def _qCurveToOne(self, pt1: tuple[float, float], pt2: tuple[float, float]) -> None:
        self.commands.append(f"Q{self._pt(pt1)} {self._pt(pt2)}")

    def _curveToOne(
        self,
        pt1: tuple[float, float],
        pt2: tuple[float, float],
        pt3: tuple[float, float],
    ) -> None:
        self.commands.append(f"C{self._pt(pt1)} {self._pt(pt2)} {self._pt(pt3)}")

    def _closePath(self) -> None:
        self.commands.append("Z")


def layout(
    stack: FontStack,
    text: str,
    size: float,
    features: dict[str, bool] | None = None,
) -> Layout:
    """Shapes and draws `text` at `size` SVG units per em."""
    glyphs = stack.shape(text, features)
    metrics = stack.metrics()
    pen = _SVGPen(size / metrics.upem)
    x = 0.0
    for glyph in glyphs:
        font = stack.fonts[glyph.font]
        pen.scale = size / font.upem
        pen.dx = x + glyph.x_offset * pen.scale
        pen.dy = -glyph.y_offset * pen.scale
        font.font.draw_glyph_with_pen(glyph.gid, pen)
        x += glyph.x_advance * pen.scale
    ink = Bounds(min(pen.xs), min(pen.ys), max(pen.xs), max(pen.ys)) if pen.xs else None
    return Layout(
        path="".join(pen.commands),
        advance=x,
        ink=ink,
        metrics=metrics,
        scale=size / metrics.upem,
        glyphs=glyphs,
    )


def shared_viewbox(layouts: list[Layout], margin: float) -> ViewBox:
    """The smallest integer viewBox holding every layout plus `margin`."""
    box = layouts[0].extent
    for item in layouts[1:]:
        box = box.union(item.extent)
    x0 = math.floor(box.x_min - margin)
    y0 = math.floor(box.y_min - margin)
    x1 = math.ceil(box.x_max + margin)
    y1 = math.ceil(box.y_max + margin)
    return ViewBox(x0, y0, x1 - x0, y1 - y0)


def svg_document(item: Layout, viewbox: ViewBox, title: str) -> str:
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" '
        f'viewBox="{viewbox.attr()}" width="{_num(viewbox.width)}" '
        f'height="{_num(viewbox.height)}">'
        f"<title>{escape(title)}</title>"
        f'<path fill="currentColor" d="{item.path}"/>'
        "</svg>\n"
    )


def render_svg(
    font_paths: list[Path],
    text: str,
    size: float,
    features: dict[str, bool] | None = None,
    variations: dict[str, float] | None = None,
    viewbox: ViewBox | None = None,
    margin: float = 16,
) -> str:
    """One SVG layer of `text`; pass the same `viewbox` to every layer of a
    test so they stack exactly.
    """
    stack = FontStack(font_paths, variations)
    item = layout(stack, text, size, features)
    box = viewbox or shared_viewbox([item], margin)
    names = ", ".join(path.name for path in font_paths)
    return svg_document(item, box, names)
