from __future__ import annotations

import io
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


ARABIC_FEATURES = """
languagesystem DFLT dflt;
languagesystem arab dflt;
markClass fatha <anchor 100 780> @TOP;
markClass kasra <anchor 100 -20> @BOTTOM;
feature mark {
    pos base alef <anchor 150 800> mark @TOP <anchor 150 -50> mark @BOTTOM;
    pos base beh <anchor 300 200> mark @TOP <anchor 300 -200> mark @BOTTOM;
    pos base lam <anchor 150 800> mark @TOP <anchor 150 -50> mark @BOTTOM;
} mark;
feature mkmk {
    pos mark fatha <anchor 100 {stack_y}> mark @TOP;
} mkmk;
table GDEF {
    GlyphClassDef [alef beh lam], , [fatha kasra smallhightah], ;
} GDEF;
"""


def _arabic_master(rise: int = 0, stack_y: int = 880) -> Any:
    """A static Arabic master for the mark stages: alef and lam are tall
    bars (lam's top anchor sits inside its ink), beh a low box; fatha and
    kasra are anchored marks and smallhightah (U+0615) a mark drawn high
    with no anchor at all.
    `rise` moves smallhightah's outline up, as a heavier master might;
    `stack_y` is the height of fatha's mark-to-mark anchor.
    """
    from fontTools.feaLib.builder import addOpenTypeFeaturesFromString
    from fontTools.fontBuilder import FontBuilder
    from fontTools.pens.ttGlyphPen import TTGlyphPen
    from fontTools.ttLib import TTFont

    glyphs = {
        ".notdef": TTGlyphPen(None).glyph(),
        "alef": _box(100, 0, 200, 750),
        "beh": _box(50, -150, 550, 150),
        "lam": _box(100, 0, 200, 1000),
        "fatha": _box(0, 800, 200, 860),
        "kasra": _box(0, -100, 200, -40),
        "smallhightah": _box(0, 900 + rise, 150, 1100 + rise),
    }
    cmap = {
        0x0627: "alef",
        0x0628: "beh",
        0x0644: "lam",
        0x064E: "fatha",
        0x0650: "kasra",
        0x0615: "smallhightah",
    }
    builder = FontBuilder(unitsPerEm=1000, isTTF=True)
    builder.setupGlyphOrder(list(glyphs))
    builder.setupCharacterMap(cmap)
    builder.setupGlyf(glyphs)
    glyf = builder.font["glyf"]
    for glyph in glyphs.values():
        glyph.recalcBounds(glyf)
    widths = {"alef": 300, "beh": 600, "lam": 300}
    builder.setupHorizontalMetrics(
        {
            g: (widths.get(g, 0), getattr(glyph, "xMin", 0))
            for g, glyph in glyphs.items()
        }
    )
    builder.setupHorizontalHeader(ascent=1100, descent=-300)
    builder.setupNameTable({"familyName": "Anchors", "styleName": "Regular"})
    builder.setupOS2(sTypoAscender=1100, sTypoDescender=-300, version=4)
    builder.setupPost()
    addOpenTypeFeaturesFromString(
        builder.font, ARABIC_FEATURES.replace("{stack_y}", str(stack_y))
    )
    buffer = io.BytesIO()
    builder.font.save(buffer)
    buffer.seek(0)
    return TTFont(buffer)


@pytest.fixture
def arabic_master() -> Callable[..., Any]:
    return _arabic_master
