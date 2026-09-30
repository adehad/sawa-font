from __future__ import annotations

import io
from collections.abc import Callable
from typing import Any

import pytest

pytest.importorskip("fontTools")
pytest.importorskip("uharfbuzz")

from fontTools.ttLib import TTFont

from sawa_tools.build import anchors, pause
from sawa_tools.build.lines import hb_font, shape

Master = Callable[..., TTFont]

PARAMS = pause.PauseMarks((0x06D6,), 0.04, 0x064E, 0x0628)


def _data(font: TTFont) -> bytes:
    buffer = io.BytesIO()
    font.save(buffer)
    return buffer.getvalue()


def _spaced(arabic_master: Master, params: pause.PauseMarks = PARAMS) -> Any:
    font = arabic_master(extra=True)
    anchors.anchor_masters({400.0: font}, 400.0, 0.03)
    fatha_bottom = pause.reference_bottom(font, 0x064E, 0x0628)
    glyphs = pause.spacing_masters({400.0: font}, 400.0, params)
    return font, glyphs, fatha_bottom


def test_a_pause_mark_becomes_a_base_with_its_own_advance(
    arabic_master: Master,
) -> None:
    font, glyphs, _ = _spaced(arabic_master)
    assert glyphs == ["smallhighsad"]
    gdef = font["GDEF"].table
    assert gdef.GlyphClassDef.classDefs["smallhighsad"] == 1
    # 120 units of ink and 40 each side.
    assert font["hmtx"]["smallhighsad"] == (200, 40)
    assert "smallhighsad" not in anchors.letter_attached(font)


def test_a_pause_mark_sits_at_fathas_height_over_a_short_letter(
    arabic_master: Master,
) -> None:
    font, _, fatha_bottom = _spaced(arabic_master)
    glyph = font["glyf"]["smallhighsad"]
    assert glyph.yMin == round(fatha_bottom)
    assert glyph.xMin == 40


def test_harfbuzz_keeps_the_advance_and_sets_it_after_the_word(
    arabic_master: Master,
) -> None:
    font, _, _ = _spaced(arabic_master)
    order = font.getGlyphOrder()
    placed = shape(hb_font(_data(font)), "ب ۖ ب")
    names = [order[g.gid] for g in placed]
    assert names == ["beh", "space", "smallhighsad", "space", "beh"]
    # Logical order, set right to left, each glyph with room of its own.
    xs = [g.x for g in placed]
    assert xs == sorted(xs, reverse=True)
    assert len(set(xs)) == len(xs)


def test_a_monospace_pause_mark_takes_the_cell_centred(
    arabic_master: Master,
) -> None:
    params = pause.PauseMarks((0x06D6,), 0.04, 0x064E, 0x0628, cell_width=600)
    font, _, _ = _spaced(arabic_master, params)
    assert font["hmtx"]["smallhighsad"] == (600, 240)
    assert font["glyf"]["smallhighsad"].xMin == 240
