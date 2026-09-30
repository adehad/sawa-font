from __future__ import annotations

import io
from collections.abc import Callable
from typing import Any

import pytest

pytest.importorskip("fontTools")
pytest.importorskip("uharfbuzz")

from conftest import compact_params

from sawa_tools.build import anchors, compact
from sawa_tools.checks import attachment

Master = Callable[..., Any]
MARKS = {0x064E, 0x0650, 0x0615}


def _bytes(font: Any) -> bytes:
    buffer = io.BytesIO()
    font.save(buffer)
    return buffer.getvalue()


def test_an_unattached_mark_is_reported(arabic_master: Master) -> None:
    assert attachment.attachment_errors(arabic_master(), MARKS) == [
        "attached to no letter by any mark-positioning lookup: U+0615"
    ]


def test_marks_outside_the_groups_or_the_cmap_are_not_checked(
    arabic_master: Master,
) -> None:
    font = arabic_master()
    assert attachment.attachment_errors(font, {0x064E, 0x0670}) == []
    assert attachment.checked_marks(font.getBestCmap(), {0x0615, 0x0627}) == [0x0615]


def test_overlap_with_the_letter_is_reported(arabic_master: Master) -> None:
    errors = attachment.placement_errors(_bytes(arabic_master()), [0x064E], [400])
    assert "wght 400: U+064E on lam: mark ink overlaps the letter's" in errors


def test_a_mark_far_from_its_letter_is_reported(arabic_master: Master) -> None:
    errors = attachment.placement_errors(
        _bytes(arabic_master()), [0x0615], [400], max_gap_em=0.1
    )
    # Unanchored, U+0615 floats at its drawn height over the low beh.
    assert any("U+0615 on beh: mark is" in error for error in errors)


def test_an_anchored_compacted_font_passes_both_checks(
    arabic_master: Master,
) -> None:
    font = arabic_master()
    anchors.anchor_masters({400.0: font}, 400.0, 0.03)
    params = compact_params()
    compact.fit_letters(compact.Master(font, params, compact.plan(font, params, [])))
    assert attachment.attachment_errors(font, MARKS) == []
    marks = attachment.checked_marks(font.getBestCmap(), MARKS)
    assert attachment.placement_errors(_bytes(font), marks, [400]) == []


def _stack_anchor(font: Any) -> Any:
    sub = next(
        s.subtable for s in anchors.slots(font) if s.role == "mark2" and s.side == "top"
    )
    record = sub.Mark2Array.Mark2Record[sub.Mark2Coverage.glyphs.index("fatha")]
    return record.Mark2Anchor[0]


def test_a_stack_whose_marks_overlap_is_reported(arabic_master: Master) -> None:
    font = arabic_master()
    anchors.anchor_masters({400.0: font}, 400.0, 0.03)
    params = compact_params()
    compact.fit_letters(compact.Master(font, params, compact.plan(font, params, [])))
    stacks = attachment.mark_stacks(font, MARKS)
    assert (0x064E, 0x0615) in stacks
    assert attachment.stack_errors(_bytes(font), stacks, [400]) == []
    _stack_anchor(font).YCoordinate = 780
    errors = attachment.stack_errors(_bytes(font), [(0x064E, 0x0615)], [400])
    assert "wght 400: U+064E U+0615 on alef: second mark ink overlaps the first's" in (
        errors
    )
