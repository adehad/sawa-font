from __future__ import annotations

import re

import pytest

from sawa_tools.report.bidi import levels, split_runs, visual_order
from sawa_tools.report.raster import parse_viewbox, rasterise, svg_edges
from sawa_tools.report.render import layout, render_svg, shared_viewbox
from sawa_tools.report.shape import FontStack


def _path_d(svg: str) -> str:
    match = re.search(r'<path fill="currentColor" d="([^"]*)"', svg)
    assert match
    return match.group(1)


def test_layers_share_a_viewbox_and_draw_non_empty_paths(make_font) -> None:
    small = make_font("Small")
    tall = make_font("Tall", upem=2000, ascent=1900, descent=-600)
    a, b = FontStack([small]), FontStack([tall])
    layouts = [layout(a, "AB", 100), layout(b, "AB", 100)]
    box = shared_viewbox(layouts, margin=10)
    svgs = [render_svg([path], "AB", 100, viewbox=box) for path in (small, tall)]
    viewboxes = {parse_viewbox(svg) for svg in svgs}
    assert viewboxes == {box}
    assert all(_path_d(svg) for svg in svgs)
    # The taller font's line box (1900 / 2000 em above the baseline) sets the top.
    assert box.y == -95 - 10


def test_baseline_sits_at_y_zero(make_font) -> None:
    font = make_font()
    item = layout(FontStack([font]), "A", 100)
    assert item.ink is not None
    # A's box runs from the baseline up to 700 units at 100 per 1000 em.
    assert item.ink.y_max == pytest.approx(0)
    assert item.ink.y_min == pytest.approx(-70)
    guides = item.guides()
    assert guides["baseline"] == 0
    assert guides["ascender"] == -80
    assert guides["descender"] == 20
    assert guides["xHeight"] == -50
    assert guides["capHeight"] == -70


def test_rasterised_box_covers_its_outline(make_font) -> None:
    font = make_font()
    svg = render_svg([font], "A", 100, margin=0)
    box = parse_viewbox(svg)
    mask = rasterise(svg_edges(svg), box, 1.0)
    # A spans x 5..45 and y -70..0 in SVG units; the viewBox starts at x=0.
    cols = mask.any(axis=0).nonzero()[0]
    rows = mask.any(axis=1).nonzero()[0]
    assert (cols.min(), cols.max()) == (5, 44)
    assert rows.max() - rows.min() + 1 == 70


def test_fallback_stack_sends_arabic_to_the_font_that_has_it(make_font) -> None:
    latin = make_font("Latin", drop=("alef", "beh"))
    arabic = make_font("Arabic", drop=("A", "B"))
    stack = FontStack([latin, arabic])
    # The space after beh stays with the Arabic font, which also has one.
    assert stack.assign("A \u0627\u0628 B") == [0, 0, 1, 1, 1, 0]


def test_bidi_orders_an_arabic_run_inside_latin() -> None:
    text = "AB \u0627\u0628 C"
    assert levels(text) == [0, 0, 0, 1, 1, 0, 0]
    runs = visual_order(split_runs(text))
    assert [(r.start, r.end, r.rtl) for r in runs] == [
        (0, 3, False),
        (3, 5, True),
        (5, 7, False),
    ]


def test_bidi_keeps_european_digits_left_to_right_in_arabic() -> None:
    text = "\u0627 12 \u0628"
    lv = levels(text)
    assert lv[0] == 1 and lv[-1] == 1
    assert lv[2] == lv[3] == 2
    order = [r.start for r in visual_order(split_runs(text))]
    assert order == [4, 2, 0]


def test_rtl_run_is_drawn_right_to_left(make_font) -> None:
    font = make_font()
    glyphs = FontStack([font]).shape("\u0627\u0628")
    assert [g.name for g in glyphs] == ["beh", "alef"]
