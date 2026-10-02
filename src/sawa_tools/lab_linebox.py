"""Where the approved line box sits: its height is the owner's call, and
its split into a part above and below the baseline comes from the corpus.

The coverage box is the smallest top and bottom that hold the everyday ink
of all but a small share of real words: every word of the project's own
sentences and every word token of the Tanzil text, with marks outside the
everyday set taken out, shaped in the calibrated font. Each tail gets half
of the share, so the box holds at least the rest of the words.
"""

from __future__ import annotations

import math
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from collections.abc import Iterable
    from pathlib import Path

    from fontTools.ttLib import TTFont

COVERAGE = 0.995


def everyday_text(text: str, everyday: set[int]) -> str:
    """`text` without the nonspacing marks outside the everyday set."""
    import unicodedata

    return "".join(
        ch for ch in text if unicodedata.category(ch) != "Mn" or ord(ch) in everyday
    )


def corpus_words(stress: Path, mixed: Path, quran: Path | None) -> list[str]:
    """Every Arabic word token of the project's sentences and the Tanzil text."""
    from sawa_tools import lab_lines

    words = [w.text for w in lab_lines.project_words(stress, mixed)]
    if quran is not None:
        from sawa_tools.tanzil import uthmani

        for verse in uthmani(quran):
            words += [
                token
                for token in verse.split()
                if len(lab_lines._ARABIC_LETTER.findall(token)) >= 2
            ]
    return words


def ink_extents(
    font: TTFont, font_bytes: bytes, texts: Iterable[str]
) -> list[tuple[float, float]]:
    """(top, bottom) of each text's ink as HarfBuzz sets it, in font units."""
    from fontTools.pens.boundsPen import BoundsPen

    from sawa_tools import lab

    glyphs = font.getGlyphSet()
    names = font.getGlyphOrder()
    boxes: dict[int, tuple[float, float] | None] = {}

    def box(gid: int) -> tuple[float, float] | None:
        if gid not in boxes:
            pen = BoundsPen(glyphs)
            glyphs[names[gid]].draw(pen)
            boxes[gid] = (pen.bounds[1], pen.bounds[3]) if pen.bounds else None
        return boxes[gid]

    shaped: dict[str, tuple[float, float]] = {}
    out = []
    for text in texts:
        if text not in shaped:
            top, bottom = -math.inf, math.inf
            for gid, _cluster, _advance, _x, y_offset in lab.shape(
                font_bytes, [ord(c) for c in text]
            ):
                ink = box(gid)
                if ink is not None:
                    bottom = min(bottom, ink[0] + y_offset)
                    top = max(top, ink[1] + y_offset)
            shaped[text] = (top, bottom)
        out.append(shaped[text])
    return [e for e in out if math.isfinite(e[0])]


def _quantile(values: list[float], q: float) -> float:
    """The smallest value at least `q` of `values` are at or below."""
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, math.ceil(q * len(ordered)) - 1))
    return ordered[index]


def coverage_box(
    extents: list[tuple[float, float]], coverage: float = COVERAGE
) -> dict[str, Any]:
    """The top and bottom that hold at least `coverage` of the extents."""
    tail = (1 - coverage) / 2
    top = _quantile([t for t, _ in extents], 1 - tail)
    bottom = -_quantile([-b for _, b in extents], 1 - tail)
    held = sum(1 for t, b in extents if t <= top and b >= bottom)
    return {
        "top": round(top),
        "bottom": round(bottom),
        "words": len(extents),
        "held": held / len(extents),
    }


def split(
    height: float,
    upm: int,
    box: dict[str, Any],
    latin: tuple[float, float],
    extents: list[tuple[float, float]],
) -> dict[str, Any]:
    """The approved line box of `height` em, split above and below the
    baseline in the proportion of the coverage box with the Latin ink, and
    the share of the extents it holds.
    """
    top = max(box["top"], latin[0])
    bottom = min(box["bottom"], latin[1])
    units = height * upm
    above = round(units * top / (top - bottom))
    below = round(above - units)
    held = sum(1 for t, b in extents if t <= above and b >= below)
    return {"top": above, "bottom": below, "held": held / len(extents)}
