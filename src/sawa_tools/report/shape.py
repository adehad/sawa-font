"""Shapes one line of text with HarfBuzz over a fallback stack of fonts.

Each character goes to the first font in the stack whose cmap has it; marks,
spaces and punctuation stay with the previous character's font when that
font covers them. Runs split on font and bidi level, are shaped with the
whole line as context, and come back in visual order.
"""

from __future__ import annotations

import importlib
import unicodedata
from dataclasses import dataclass
from functools import cached_property
from pathlib import Path
from typing import Any

from sawa_tools.report.bidi import split_runs, visual_order

# uharfbuzz is a compiled extension without type stubs.
hb: Any = importlib.import_module("uharfbuzz")

_STRONG = {"L", "R", "AL", "EN", "AN"}


@dataclass(frozen=True)
class Glyph:
    font: int
    gid: int
    name: str
    cluster: int
    x_advance: int
    y_advance: int
    x_offset: int
    y_offset: int


@dataclass(frozen=True)
class LineMetrics:
    """Font-unit vertical metrics of a stack, as HarfBuzz reports them."""

    upem: int
    ascender: int
    descender: int
    line_gap: int
    x_height: int | None
    cap_height: int | None


class StackFont:
    def __init__(self, path: Path, variations: dict[str, float] | None = None):
        self.path = path
        self.face = hb.Face(path.read_bytes())
        self.font = hb.Font(self.face)
        axes = {axis.tag for axis in self.face.axis_infos}
        wanted = {
            tag: value for tag, value in (variations or {}).items() if tag in axes
        }
        if wanted:
            self.font.set_variations(wanted)

    @cached_property
    def cmap(self) -> set[int]:
        return set(self.face.unicodes)

    @property
    def upem(self) -> int:
        return self.face.upem

    def metric(self, tag: Any) -> int | None:
        value = self.font.get_metric_position(tag)
        return value or None


class FontStack:
    def __init__(self, paths: list[Path], variations: dict[str, float] | None = None):
        if not paths:
            raise ValueError("a font stack needs at least one font")
        self.fonts = [StackFont(path, variations) for path in paths]

    def assign(self, text: str) -> list[int]:
        """Index of the font each character of `text` is shaped with."""
        chosen: list[int] = []
        for ch in text:
            cp = ord(ch)
            prev = chosen[-1] if chosen else None
            weak = (
                unicodedata.category(ch).startswith("M")
                or unicodedata.bidirectional(ch) not in _STRONG
            )
            if weak and prev is not None and cp in self.fonts[prev].cmap:
                chosen.append(prev)
                continue
            chosen.append(
                next((i for i, f in enumerate(self.fonts) if cp in f.cmap), 0)
            )
        return chosen

    def metrics(self) -> LineMetrics:
        """The stack's line box: the tallest ascender and deepest descender of
        its fonts, scaled to the first font's units per em; x-height and cap
        height come from the first font that has them.
        """
        first = self.fonts[0]

        def scaled(font: StackFont, value: int) -> int:
            return round(value * first.upem / font.upem)

        extents = [(f, f.font.get_font_extents("ltr")) for f in self.fonts]
        x_height = next(
            (
                scaled(f, v)
                for f in self.fonts
                if (v := f.metric(hb.OTMetricsTag.X_HEIGHT))
            ),
            None,
        )
        cap_height = next(
            (
                scaled(f, v)
                for f in self.fonts
                if (v := f.metric(hb.OTMetricsTag.CAP_HEIGHT))
            ),
            None,
        )
        return LineMetrics(
            upem=first.upem,
            ascender=max(scaled(f, e.ascender) for f, e in extents),
            descender=min(scaled(f, e.descender) for f, e in extents),
            line_gap=max(scaled(f, e.line_gap) for f, e in extents),
            x_height=x_height,
            cap_height=cap_height,
        )

    def shape(self, text: str, features: dict[str, bool] | None = None) -> list[Glyph]:
        """Glyphs for `text` in visual (left to right) order, in each glyph's
        own font units; clusters are character indices into `text`.
        """
        codepoints = [ord(ch) for ch in text]
        owners = self.assign(text)
        glyphs: list[Glyph] = []
        runs = split_runs(text, list(owners))
        for run in visual_order(runs):
            index = owners[run.start]
            stack_font = self.fonts[index]
            buf = hb.Buffer()
            buf.add_codepoints(codepoints, run.start, run.end - run.start)
            buf.direction = "rtl" if run.rtl else "ltr"
            buf.guess_segment_properties()
            hb.shape(stack_font.font, buf, features or {})
            for info, pos in zip(buf.glyph_infos, buf.glyph_positions, strict=True):
                glyphs.append(
                    Glyph(
                        font=index,
                        gid=info.codepoint,
                        name=stack_font.font.glyph_to_string(info.codepoint),
                        cluster=info.cluster,
                        x_advance=pos.x_advance,
                        y_advance=pos.y_advance,
                        x_offset=pos.x_offset,
                        y_offset=pos.y_offset,
                    )
                )
        return glyphs
