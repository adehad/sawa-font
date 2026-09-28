from __future__ import annotations

from sawa_tools.report.diff import components, diff_regions
from sawa_tools.report.render import layout, shared_viewbox, svg_document
from sawa_tools.report.shape import FontStack


def _pair(make_font, shift: int) -> tuple[str, str]:
    stacks = [
        FontStack([make_font("Base")]),
        FontStack([make_font("Moved", shift=shift)]),
    ]
    layouts = [layout(stack, "AB", 100) for stack in stacks]
    box = shared_viewbox(layouts, margin=10)
    return svg_document(layouts[0], box, "a"), svg_document(layouts[1], box, "b")


def test_identical_layers_have_no_regions(make_font) -> None:
    same, _ = _pair(make_font, shift=0)
    assert diff_regions(same, same) == []
    a, b = _pair(make_font, shift=0)
    assert diff_regions(a.replace("<title>a", "<title>b"), b) == []


def test_a_shifted_glyph_gives_regions_at_its_moved_edges(make_font) -> None:
    a, b = _pair(make_font, shift=40)
    regions = diff_regions(a, b)
    # B is a solid box at x 55..95 (pen 50 + bearing 5), moved right by 4
    # units: only the slivers at its left and right edges change.
    assert len(regions) == 2
    left, right = regions
    assert left.x <= 55 and left.x + left.width >= 59
    assert right.x <= 95 and right.x + right.width >= 99
    for region in regions:
        assert region.y <= -50 and region.y + region.height >= 0
        # A (x 5..45) did not move.
        assert region.x > 45


def test_components_split_far_apart_blobs() -> None:
    import numpy as np

    mask = np.zeros((10, 30), dtype=bool)
    mask[2:4, 1:3] = True
    mask[5:9, 20:25] = True
    found = components(mask)
    assert [c.box for c in found] == [(1, 2, 3, 4), (20, 5, 25, 9)]
    assert [c.pixels for c in found] == [4, 20]


def test_specks_below_the_minimum_area_are_dropped() -> None:
    import numpy as np

    from sawa_tools.report.diff import drop_specks

    mask = np.zeros((10, 30), dtype=bool)
    mask[1, 1:4] = True
    mask[5:7, 20:22] = True
    kept = drop_specks(mask, 4)
    assert not kept[1].any()
    assert kept[5:7, 20:22].all()


def test_layers_with_different_viewboxes_compare_on_shared_origin(make_font) -> None:
    font = make_font()
    stack = FontStack([font])
    item = layout(stack, "A", 100)
    narrow = shared_viewbox([item], margin=5)
    wide = shared_viewbox([item], margin=40)
    assert (
        diff_regions(svg_document(item, narrow, "a"), svg_document(item, wide, "a"))
        == []
    )
