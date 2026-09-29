"""HarfBuzz shaping of one letter with one mark, and the ink of each part."""

from __future__ import annotations

import copy
import importlib
import io
from collections import Counter
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from sawa_tools.build.ink import EdgePen, box, moved

if TYPE_CHECKING:
    from collections.abc import Iterable

    from fontTools.ttLib import TTFont

    from sawa_tools.build.ink import Box, Edge


@dataclass(frozen=True)
class Placed:
    gid: int
    x: float
    y: float
    cluster: int


class Shaper:
    def __init__(self, data: bytes, variations: dict[str, float] | None = None):
        # uharfbuzz is a compiled extension without type stubs.
        self.hb: Any = importlib.import_module("uharfbuzz")
        face = self.hb.Face(data)
        self.upem: int = face.upem
        self.font = self.hb.Font(face)
        if variations:
            self.font.set_variations(variations)
        self._edges: dict[int, list[Edge]] = {}
        self._boxes: dict[int, Box | None] = {}

    @classmethod
    def of(cls, font: TTFont) -> Shaper:
        """A shaper over `font` as it stands, leaving `font` itself untouched:
        compiling sets writer-side attributes on some subtables, and varLib
        needs masters to match attribute for attribute.
        """
        buffer = io.BytesIO()
        copy.deepcopy(font).save(buffer)
        return cls(buffer.getvalue())

    def shape(self, text: str) -> list[Placed]:
        """The shaped glyphs of `text` in logical order."""
        buf = self.hb.Buffer()
        buf.add_str(text)
        buf.guess_segment_properties()
        self.hb.shape(self.font, buf)
        placed, x = [], 0.0
        for info, pos in zip(buf.glyph_infos, buf.glyph_positions, strict=True):
            placed.append(
                Placed(info.codepoint, x + pos.x_offset, pos.y_offset, info.cluster)
            )
            x += pos.x_advance
        return placed[::-1] if buf.direction == "rtl" else placed

    def split(
        self, text: str, index: int, mark: str
    ) -> tuple[list[Placed], list[Placed]]:
        """Shapes `text` with `mark` after its character at `index`, and
        returns that character's cluster split into the letter's own glyphs
        and the glyphs the mark added.
        """
        alone = Counter(g.gid for g in self.shape(text) if g.cluster == index)
        shaped = self.shape(text[: index + 1] + mark + text[index + 1 :])
        letter, added = [], []
        for glyph in shaped:
            if glyph.cluster != index:
                continue
            if alone[glyph.gid] > 0:
                alone[glyph.gid] -= 1
                letter.append(glyph)
            else:
                added.append(glyph)
        return letter, added

    def _glyph_edges(self, gid: int) -> list[Edge]:
        if gid not in self._edges:
            pen = EdgePen()
            self.font.draw_glyph_with_pen(gid, pen)
            self._edges[gid] = pen.edges
            self._boxes[gid] = box(pen.edges)
        return self._edges[gid]

    def edges(self, glyphs: Iterable[Placed]) -> list[Edge]:
        result = []
        for glyph in glyphs:
            result += moved(self._glyph_edges(glyph.gid), glyph.x, glyph.y)
        return result

    def box(self, glyphs: Iterable[Placed]) -> Box | None:
        """The union of the glyphs' ink boxes, None when none has ink."""
        found = None
        for glyph in glyphs:
            self._glyph_edges(glyph.gid)
            own = self._boxes[glyph.gid]
            if own is None:
                continue
            placed = (
                own[0] + glyph.x,
                own[1] + glyph.y,
                own[2] + glyph.x,
                own[3] + glyph.y,
            )
            found = (
                placed
                if found is None
                else (
                    min(found[0], placed[0]),
                    min(found[1], placed[1]),
                    max(found[2], placed[2]),
                    max(found[3], placed[3]),
                )
            )
        return found
