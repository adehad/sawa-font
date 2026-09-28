from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest

MakeFont = Callable[..., Path]


def _box(x0: int, y0: int, x1: int, y1: int) -> Any:
    from fontTools.pens.ttGlyphPen import TTGlyphPen

    pen = TTGlyphPen(None)
    pen.moveTo((x0, y0))
    pen.lineTo((x0, y1))
    pen.lineTo((x1, y1))
    pen.lineTo((x1, y0))
    pen.closePath()
    return pen.glyph()


@pytest.fixture
def make_font(tmp_path: Path) -> MakeFont:
    """Writes a small TTF: A and B are boxes, U+0627 (alef) a tall bar,
    U+0628 (beh) a low box, space is empty. `shift` moves B's outline right.
    """

    def build(
        name: str = "Fixture",
        upem: int = 1000,
        ascent: int = 800,
        descent: int = -200,
        shift: int = 0,
        drop: tuple[str, ...] = (),
    ) -> Path:
        from fontTools.fontBuilder import FontBuilder
        from fontTools.pens.ttGlyphPen import TTGlyphPen

        k = upem / 1000
        glyphs: dict[str, Any] = {
            ".notdef": TTGlyphPen(None).glyph(),
            "space": TTGlyphPen(None).glyph(),
            "A": _box(int(50 * k), 0, int(450 * k), int(700 * k)),
            "B": _box(int((50 + shift) * k), 0, int((450 + shift) * k), int(500 * k)),
            "alef": _box(int(100 * k), 0, int(200 * k), int(750 * k)),
            "beh": _box(int(50 * k), int(-150 * k), int(550 * k), int(150 * k)),
        }
        cmap = {32: "space", 65: "A", 66: "B", 0x0627: "alef", 0x0628: "beh"}
        for glyph in drop:
            del glyphs[glyph]
            cmap = {cp: g for cp, g in cmap.items() if g != glyph}
        builder = FontBuilder(unitsPerEm=upem, isTTF=True)
        builder.setupGlyphOrder(list(glyphs))
        builder.setupCharacterMap(cmap)
        builder.setupGlyf(glyphs)
        glyf = builder.font["glyf"]
        for glyph in glyphs.values():
            glyph.recalcBounds(glyf)
        widths = {"alef": 300, "beh": 600}
        # HarfBuzz places glyf outlines by the hmtx left side bearing, so it
        # has to match each outline's xMin.
        builder.setupHorizontalMetrics(
            {
                g: (int(widths.get(g, 500) * k), getattr(glyph, "xMin", 0))
                for g, glyph in glyphs.items()
            }
        )
        builder.setupHorizontalHeader(ascent=ascent, descent=descent)
        builder.setupNameTable({"familyName": name, "styleName": "Regular"})
        builder.setupOS2(
            sTypoAscender=ascent,
            sTypoDescender=descent,
            usWinAscent=ascent,
            usWinDescent=-descent,
            sxHeight=int(500 * k),
            sCapHeight=int(700 * k),
            version=4,
        )
        builder.setupPost()
        path = tmp_path / f"{name}.ttf"
        builder.save(str(path))
        return path

    return build
