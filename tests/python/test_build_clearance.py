from __future__ import annotations

import math

import pytest

np = pytest.importorskip("numpy")

from sawa_tools.build import clearance  # noqa: E402


def _square(
    x0: float, y0: float, x1: float, y1: float, step: float = 2.0
) -> clearance.Ink:
    def draw(pen: clearance.SamplePen) -> None:
        pen.moveTo((x0, y0))
        pen.lineTo((x0, y1))
        pen.lineTo((x1, y1))
        pen.lineTo((x1, y0))
        pen.closePath()

    return clearance.Ink.drawn(draw, step)


def test_distance_between_two_boxes_is_the_gap_between_their_edges() -> None:
    a, b = _square(0, 0, 100, 100), _square(0, 0, 100, 100)
    assert clearance.distance(a, b, (140, 0), 100) == pytest.approx(40)
    assert clearance.distance(a, b, (140, 0), 30) >= 30


def test_ink_inside_other_ink_is_at_distance_zero() -> None:
    outer, inner = _square(0, 0, 300, 300), _square(0, 0, 20, 20)
    assert clearance.distance(outer, inner, (140, 140), 30) == 0.0
    assert clearance.distance(inner, outer, (-140, -140), 30) == 0.0


def test_approach_is_the_room_left_above_the_gap() -> None:
    mark = _square(0, 200, 100, 260).points
    letter = _square(0, 0, 100, 100).points
    # 100 units of air, of which the 30-unit gap must stay.
    assert clearance.approach(mark, letter, 30, -1) == pytest.approx(70)


def test_approach_is_negative_when_already_too_close() -> None:
    mark = _square(0, 110, 100, 160).points
    letter = _square(0, 0, 100, 100).points
    assert clearance.approach(mark, letter, 30, -1) == pytest.approx(-20)


def test_approach_is_unbounded_with_no_ink_in_the_way() -> None:
    mark = _square(0, 200, 100, 260).points
    beside = _square(300, 0, 400, 100).points
    assert clearance.approach(mark, beside, 30, -1) == math.inf


def test_ink_behind_the_mark_does_not_limit_its_approach() -> None:
    mark = _square(0, 200, 100, 260).points
    arm_and_letter = np.concatenate(
        [_square(0, 400, 100, 450).points, _square(0, 0, 100, 100).points]
    )
    assert clearance.approach(mark, arm_and_letter, 30, -1) == pytest.approx(70)


def test_a_mark_inside_a_letter_is_pushed_clear_of_all_of_it() -> None:
    mark = _square(0, 800, 100, 860).points
    lam = _square(0, 0, 100, 1000).points
    # Its bottom must go 30 above lam's top at 1000.
    assert clearance.approach(mark, lam, 30, -1) == pytest.approx(-230)
