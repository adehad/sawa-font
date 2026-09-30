"""Shapes whole lines with HarfBuzz and measures their ink: the line's
vertical extent, and every place a mark comes closer than a clearance to
another glyph's ink.

Lines are split into bidi runs (report/bidi.py) and each run is shaped on
its own, laid out left to right in visual order.
"""

from __future__ import annotations

import importlib
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

import numpy as np

from sawa_tools.build.clearance import INF, Ink, distance
from sawa_tools.report.bidi import split_runs, visual_order

if TYPE_CHECKING:
    from collections.abc import Collection, Iterable


def harfbuzz() -> Any:
    # uharfbuzz is a compiled extension without type stubs.
    return importlib.import_module("uharfbuzz")


def hb_font(data: bytes, wght: float | None = None) -> Any:
    hb = harfbuzz()
    face = hb.Face(data)
    font = hb.Font(face)
    if wght is not None and any(a.tag == "wght" for a in face.axis_infos):
        font.set_variations({"wght": wght})
    return font


@dataclass(frozen=True)
class Placed:
    """A shaped glyph at its absolute position; `index` is its place in its
    run's logical order and `cluster` the text index HarfBuzz gave it.
    """

    gid: int
    x: int
    y: int
    cluster: int
    run: int
    index: int
    rtl: bool


def shape(font: Any, text: str) -> list[Placed]:
    """Glyphs of `text` in visual order, each run's in logical order."""
    hb = harfbuzz()
    codepoints = [ord(ch) for ch in text]
    placed: list[Placed] = []
    pen = 0
    for number, run in enumerate(visual_order(split_runs(text))):
        buf = hb.Buffer()
        buf.add_codepoints(codepoints, run.start, run.end - run.start)
        buf.direction = "rtl" if run.rtl else "ltr"
        buf.guess_segment_properties()
        hb.shape(font, buf)
        glyphs = []
        for info, pos in zip(buf.glyph_infos, buf.glyph_positions, strict=True):
            glyphs.append(
                (info.codepoint, pen + pos.x_offset, pos.y_offset, info.cluster)
            )
            pen += pos.x_advance
        if run.rtl:
            glyphs.reverse()
        placed += [
            Placed(gid, x, y, cluster, number, i, run.rtl)
            for i, (gid, x, y, cluster) in enumerate(glyphs)
        ]
    return placed


@dataclass(frozen=True)
class Contact:
    """Two glyphs of a line whose inks are `gap` apart, `mark` being one of
    the checked marks; `same_cluster` when both belong to one cluster.
    """

    mark: Placed
    other: Placed
    gap: float
    same_cluster: bool


@dataclass
class InkTable:
    """Each glyph's ink in one font, and which glyphs are GDEF marks and
    which marks the clearance applies to.
    """

    font: Any
    step: float
    marks: frozenset[int]
    checked: frozenset[int]
    _inks: dict[int, Ink] = field(default_factory=dict)
    _gaps: dict[tuple[int, int, int, int], float] = field(default_factory=dict)

    def ink(self, gid: int) -> Ink:
        found = self._inks.get(gid)
        if found is None:
            found = self._inks[gid] = Ink.drawn(
                lambda pen: self.font.draw_glyph_with_pen(gid, pen), self.step
            )
        return found

    def extent(self, placed: Iterable[Placed]) -> tuple[float, float] | None:
        """The line's highest and lowest ink, or None for a line without ink."""
        top, bottom = -INF, INF
        for glyph in placed:
            box = self.ink(glyph.gid).box
            if box is not None:
                top = max(top, box[3] + glyph.y)
                bottom = min(bottom, box[1] + glyph.y)
        return None if top == -INF else (top, bottom)

    def gap(self, a: Placed, b: Placed, limit: float) -> float:
        key = (a.gid, b.gid, b.x - a.x, b.y - a.y)
        found = self._gaps.get(key)
        if found is None:
            found = self._gaps[key] = distance(
                self.ink(a.gid), self.ink(b.gid), (b.x - a.x, b.y - a.y), limit
            )
        return found

    def contacts(
        self,
        placed: list[Placed],
        clearance: float,
        movers: Collection[int] | None = None,
    ) -> list[Contact]:
        """Every pair of a checked mark (of `movers`, when given) and another
        inked glyph closer than `clearance`, each pair once.
        """
        inked = [g for g in placed if self.ink(g.gid)]
        if not inked:
            return []
        boxes = np.array(
            [
                [
                    b[0] + g.x - clearance,
                    b[1] + g.y - clearance,
                    b[2] + g.x + clearance,
                    b[3] + g.y + clearance,
                ]
                for g in inked
                if (b := self.ink(g.gid).box) is not None
            ]
        )
        wanted = self.checked if movers is None else movers
        found = []
        for i, a in enumerate(inked):
            if a.gid not in wanted:
                continue
            near = (
                (boxes[:, 0] < boxes[i, 2])
                & (boxes[:, 2] > boxes[i, 0])
                & (boxes[:, 1] < boxes[i, 3])
                & (boxes[:, 3] > boxes[i, 1])
            )
            near[i] = False
            for j in np.flatnonzero(near):
                b = inked[j]
                # A pair of two movers is found once, from the earlier one.
                if b.gid in wanted and j < i:
                    continue
                d = self.gap(a, b, clearance)
                if d < clearance:
                    found.append(
                        Contact(a, b, d, (a.run, a.cluster) == (b.run, b.cluster))
                    )
        return found


def mark_glyphs(font: Any) -> frozenset[str]:
    """The GDEF mark glyphs of a fontTools font."""
    gdef = font["GDEF"].table if "GDEF" in font else None
    classes = gdef.GlyphClassDef.classDefs if gdef and gdef.GlyphClassDef else {}
    return frozenset(g for g, c in classes.items() if c == 3)
