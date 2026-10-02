import re
from pathlib import Path
from typing import Any

import pytest

from sawa_tools import lab, lab_parts

DOWNLOADS = Path(".cache/downloads")
needs_noto = pytest.mark.skipif(
    not (DOWNLOADS / "noto_sans_arabic").exists(),
    reason="needs the cached Noto sources (sawa build fonts)",
)


def _square(pen: Any, x0: int, y0: int, x1: int, y1: int, clockwise: bool) -> None:
    points = [(x0, y0), (x0, y1), (x1, y1), (x1, y0)]
    if not clockwise:
        points.reverse()
    pen.moveTo(points[0])
    for point in points[1:]:
        pen.lineTo(point)
    pen.closePath()


def _font() -> Any:
    """A body with a counter and two dots under it, a body with one dot
    above, and a composite of a body and a dot component.
    """
    from fontTools.fontBuilder import FontBuilder
    from fontTools.pens.ttGlyphPen import TTGlyphPen
    from fontTools.ttLib.tables._g_l_y_f import Glyph, GlyphComponent

    def glyph(draw: Any) -> Any:
        pen = TTGlyphPen(None)
        draw(pen)
        return pen.glyph()

    def bowl(pen: Any) -> None:
        _square(pen, 0, 0, 600, 300, clockwise=True)
        _square(pen, 100, 100, 200, 200, clockwise=False)
        _square(pen, 200, -200, 280, -120, clockwise=True)
        _square(pen, 320, -200, 400, -120, clockwise=True)

    def bar(pen: Any) -> None:
        _square(pen, 0, 0, 500, 100, clockwise=True)
        _square(pen, 220, 250, 300, 330, clockwise=True)

    glyphs = {
        ".notdef": glyph(lambda pen: None),
        "bowl": glyph(bowl),
        "bar": glyph(bar),
        "dotless": glyph(lambda pen: _square(pen, 0, 0, 500, 100, clockwise=True)),
        "dotbelowar": glyph(lambda pen: _square(pen, 0, 0, 80, 80, clockwise=True)),
    }
    composite = Glyph()
    composite.numberOfContours = -1
    composite.components = []
    for name, x, y in (("dotless", 0, 0), ("dotbelowar", 200, -150)):
        component = GlyphComponent()
        component.glyphName, component.x, component.y, component.flags = name, x, y, 0
        composite.components.append(component)
    glyphs["composed"] = composite
    builder = FontBuilder(unitsPerEm=1000, isTTF=True)
    builder.setupGlyphOrder(list(glyphs))
    builder.setupCharacterMap({})
    builder.setupGlyf(glyphs)
    builder.setupHorizontalMetrics({name: (600, 0) for name in glyphs})
    builder.setupHorizontalHeader(ascent=800, descent=-200)
    builder.setupPost()
    return builder.font


def test_small_outer_contours_are_dots_and_counters_are_not() -> None:
    parts = lab_parts.glyph_parts(_font(), "bowl")
    assert [(p.id, p.kind, p.position, p.count) for p in parts] == [
        ("body", "body", None, 0),
        ("contours:2,3", "dots", "below", 2),
    ]


def test_a_dot_over_a_bar_sits_above_it() -> None:
    parts = lab_parts.glyph_parts(_font(), "bar")
    assert [(p.kind, p.position, p.count) for p in parts[1:]] == [("dots", "above", 1)]


def test_dot_components_are_parts_of_a_composite() -> None:
    font = _font()
    parts = lab_parts.glyph_parts(font, "composed")
    assert [(p.id, p.position, p.count) for p in parts[1:]] == [
        ("component:1", "below", 1)
    ]
    body = lab_parts.part_path(font, parts[0])
    dot = lab_parts.part_path(font, parts[1])
    assert body == "M0 0L0 100L500 100L500 0Z"
    assert dot == "M200 -150L200 -70L280 -70L280 -150Z"


def test_part_paths_use_only_the_commands_the_lab_parses() -> None:
    font = _font()
    for part in lab_parts.glyph_parts(font, "bowl"):
        assert re.fullmatch(r"([MLQCZ][-0-9. ]*)+", lab_parts.part_path(font, part))
    dots = lab_parts.glyph_parts(font, "bowl")[1]
    assert lab_parts.part_path(font, dots).count("M") == 2


def _every(dots: list[tuple[str, int]]) -> dict[str, list[tuple[str, int]]]:
    return {form: dots for form in lab.FORMS}


# (letter, form) -> the letter's dot groups as (position, dots), from Noto
# Sans Arabic. Yeh keeps its two dots in the final form.
EXPECTED_DOTS = {
    "ب": _every([("below", 1)]),
    "ت": _every([("above", 2)]),
    "ث": _every([("above", 3)]),
    "ج": {
        "isolated": [("inside", 1)],
        "initial": [("below", 1)],
        "medial": [("below", 1)],
        "final": [("inside", 1)],
    },
    "خ": _every([("above", 1)]),
    "ن": _every([("above", 1)]),
    "ق": _every([("above", 2)]),
    "ي": _every([("below", 2)]),
    "ش": _every([("above", 3)]),
    "ح": _every([]),
    "م": _every([]),
}


@pytest.fixture(scope="module")
def calib(tmp_path_factory: pytest.TempPathFactory) -> dict[str, Any]:
    out = tmp_path_factory.mktemp("lab")
    return lab.build_lab_fonts(
        out_dir=out,
        scale=1.15,
        manifest=Path("data/upstream.json"),
        families=Path("data/sawa.json"),
        cache_dir=DOWNLOADS,
    ) | {"out": out}


@needs_noto
def test_letter_forms_split_into_body_and_dot_groups(calib: dict[str, Any]) -> None:
    found = {}
    for char, forms in EXPECTED_DOTS.items():
        for form in forms:
            entry = calib["letterForms"][f"U+{ord(char):04X}|{form}"]
            found[char, form] = [
                (p["position"], p["count"])
                for p in entry["parts"]
                if p["kind"] == "dots"
            ]
    expected = {
        (char, form): dots
        for char, forms in EXPECTED_DOTS.items()
        for form, dots in forms.items()
    }
    assert found == expected


@needs_noto
def test_cmap_composites_split_the_same_way(calib: dict[str, Any]) -> None:
    from fontTools.ttLib import TTFont

    font = TTFont(calib["out"] / "calib.ttf")
    cmap = font.getBestCmap() or {}
    found = {
        char: [
            (p.position, p.count)
            for p in lab_parts.glyph_parts(font, cmap[ord(char)])
            if p.kind == "dots"
        ]
        for char in "بتثجخنقيش"
    }
    assert found == {
        "ب": [("below", 1)],
        "ت": [("above", 2)],
        "ث": [("above", 3)],
        "ج": [("inside", 1)],
        "خ": [("above", 1)],
        "ن": [("above", 1)],
        "ق": [("above", 2)],
        "ي": [("below", 2)],
        "ش": [("above", 3)],
    }


@needs_noto
def test_glyph_table_carries_parts_and_anchors(calib: dict[str, Any]) -> None:
    beh = calib["letterForms"]["U+0628|initial"]
    assert beh["body"] == "uni066E.init"
    body = calib["glyphs"]["uni066E.init"]
    assert body["class"] == "base"
    assert [p["id"] for p in body["parts"]] == ["body"]
    assert body["parts"][0]["d"].startswith("M")
    assert {a["kind"] for a in body["anchors"]} == {"base"}
    dot = calib["glyphs"]["dotbelowar"]
    assert dot["class"] == "mark"
    assert {"mark", "mark2"} <= {a["kind"] for a in dot["anchors"]}
