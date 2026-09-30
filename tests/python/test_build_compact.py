from __future__ import annotations

import io
from collections.abc import Callable
from typing import Any

import pytest

pytest.importorskip("fontTools")
pytest.importorskip("uharfbuzz")
pytest.importorskip("numpy")

from conftest import compact_params
from fontTools.ttLib import TTFont

from sawa_tools.build import anchors, compact
from sawa_tools.build.harfbuzz import Shaper

Master = Callable[..., TTFont]

PARAMS = compact_params()


def _shaped(font: TTFont, text: str) -> list[Any]:
    buffer = io.BytesIO()
    font.save(buffer)
    return Shaper(buffer.getvalue()).shape(text)


# The corpus the plan learns which marks stack on which from.
CORPUS = ["اَؕ"]


def _master(arabic_master: Master, **kwargs: Any) -> compact.Master:
    font = arabic_master(**kwargs)
    anchors.anchor_masters({400.0: font}, 400.0, 0.03)
    return compact.Master(font, PARAMS, compact.plan(font, PARAMS, CORPUS))


def test_fatha_drops_onto_a_tall_letter_until_the_gap(arabic_master: Master) -> None:
    master = _master(arabic_master)
    compact.fit_letters(master)
    fatha = _shaped(master.font, "اَ")[-1]
    # alef's ink tops out at 750; fatha's ink starts 800 above its origin.
    assert 800 + fatha.y == pytest.approx(750 + 32, abs=1)


def test_fatha_inside_a_letter_is_lifted_clear(arabic_master: Master) -> None:
    master = _master(arabic_master)
    compact.fit_letters(master)
    fatha = _shaped(master.font, "لَ")[-1]
    # lam's ink reaches 1000 and its top anchor sits inside it.
    assert 800 + fatha.y == pytest.approx(1000 + 32, abs=1)


def test_a_low_anchor_under_the_ceiling_stays(arabic_master: Master) -> None:
    master = _master(arabic_master)
    before = _shaped(master.font, "بَ")[-1]
    compact.fit_letters(master)
    assert _shaped(master.font, "بَ")[-1].y == before.y


def test_a_stacked_mark_tightens_to_the_gap(arabic_master: Master) -> None:
    master = _master(arabic_master, stack_y=960)
    compact.tighten_stacks(master)
    fatha, tah = _shaped(master.font, "اَؕ")[1:]
    # fatha's ink tops out at 860; smallhightah's starts 900 above its origin.
    assert 900 + tah.y == pytest.approx(860 + fatha.y + 32, abs=1)


def _ink_gap(font: TTFont, text: str, first: str, second: str) -> float:
    from sawa_tools.build.clearance import Ink, distance

    glyphset = font.getGlyphSet()
    order = font.getGlyphOrder()
    placed = {order[g.gid]: g for g in _shaped(font, text)}
    a, b = placed[first], placed[second]

    def ink(name: str) -> Ink:
        return Ink.drawn(lambda pen: glyphset[name].draw(pen), 1, glyphset)

    return distance(ink(first), ink(second), (b.x - a.x, b.y - a.y), 1000)


def test_fatha_keeps_one_gap_over_a_dot_and_over_a_bare_letter(
    arabic_master: Master,
) -> None:
    font = arabic_master(extra=True)
    anchors.anchor_masters({400.0: font}, 400.0, 0.03)
    params = compact_params(ceiling=0)
    master = compact.Master(font, params, compact.plan(font, params, ["تَ"]))
    compact.split_classes(master)
    compact.tighten_stacks(master)
    compact.fit_letters(master)
    # The dot is drawn at its origin; fatha stacks on it and still keeps
    # the gap to the dot's ink, as it does to beh's without one.
    assert _ink_gap(font, "تَ", "fatha", "dotabove") == pytest.approx(32, abs=2)
    assert _ink_gap(font, "بَ", "fatha", "beh") == pytest.approx(32, abs=2)


def test_own_classes_keep_every_anchor(arabic_master: Master) -> None:
    master = _master(arabic_master)
    before = [g.y for g in _shaped(master.font, "اَؕ")]
    compact.split_classes(master)
    assert [g.y for g in _shaped(master.font, "اَؕ")] == before
    sub = next(s for _, _, kind, s in compact.subtables(master.font) if kind == 4)
    names, records = compact._mark_records(4, sub)
    classes = {n: r.Class for n, r in zip(names, records, strict=True)}
    assert classes["fatha"] != classes["smallhightah"]


def test_each_master_gets_its_own_moves_in_one_structure(
    arabic_master: Master,
) -> None:
    light, bold = arabic_master(), arabic_master()
    before = {t: _shaped(light, t)[-1] for t in ("اَ", "بَ")}
    rules: list[compact.Rules] = [
        {("alef", "fatha"): {1: (8, 20)}},
        {("alef", "fatha"): {1: (0, -12)}, ("beh", "fatha"): {1: (4, 0)}},
    ]
    layers: dict[compact.Context, int] = {("alef", "fatha"): 0, ("beh", "fatha"): 0}
    added = compact.add_contexts([light, bold], rules, layers)
    # fatha moves by two different offsets, so two single adjustments, and
    # one contextual lookup.
    assert added == 3
    assert len(light["GPOS"].table.LookupList.Lookup) == len(
        bold["GPOS"].table.LookupList.Lookup
    )

    def moved(font: TTFont, text: str) -> tuple[int, int]:
        glyph, old = _shaped(font, text)[-1], before[text]
        return glyph.x - old.x, glyph.y - old.y

    assert moved(light, "اَ") == (8, 20)
    assert moved(light, "بَ") == (0, 0)
    assert moved(bold, "اَ") == (0, -12)
    assert moved(bold, "بَ") == (4, 0)


def test_overlapping_contexts_get_different_layers() -> None:
    placed = [
        compact.Placed(gid, 0, 0, cluster, 0, i, True)
        for i, (gid, cluster) in enumerate([(1, 0), (2, 0), (3, 1), (2, 1)])
    ]
    order = [".notdef", "beh", "fatha", "alef"]
    line = compact.Line(placed, [])
    first, second, third = (
        ("beh", "fatha", "alef"),
        ("alef", "fatha"),
        ("fatha", "alef"),
    )
    layers = compact.layer_rules([line], [first, second, third], order)
    # Every pair overlaps somewhere in beh fatha alef fatha.
    assert len({layers[first], layers[second], layers[third]}) == 3
    alone = compact.layer_rules([line], [first, ("fatha", "beh")], order)
    assert alone[first] == alone[("fatha", "beh")]


def test_further_moves_add_up() -> None:
    rules: compact.Rules = {("beh", "fatha"): {1: (4, 0)}}
    assert compact.merge_moves(rules, {("beh", "fatha"): {1: (-4, 8)}})
    assert rules == {("beh", "fatha"): {1: (0, 8)}}
    assert not compact.merge_moves(rules, {})


def test_moves_that_add_up_past_the_limits_are_held_to_them() -> None:
    rules: compact.Rules = {("beh", "fatha", "kasra"): {1: (90, 400), 2: (-300, -10)}}
    limits = compact.MoveLimits(lift=300, shift=80, shifts={"kasra": 200})
    compact.clamp_moves(rules, limits)
    assert rules == {("beh", "fatha", "kasra"): {1: (80, 300), 2: (-200, -10)}}
