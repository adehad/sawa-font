from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest

pytest.importorskip("fontTools")

from sawa_tools.build import masters

Master = Callable[..., Any]


def test_masters_are_built_once_per_key(arabic_master: Master, tmp_path: Path) -> None:
    calls = []

    def build() -> dict[float, Any]:
        calls.append(1)
        return {400.0: arabic_master(), 700.0: arabic_master(rise=40)}

    cache = masters.MastersCache(tmp_path / "fam", "k1")
    first = cache.get(build)
    second = cache.get(build)
    assert len(calls) == 1
    assert sorted(second) == [400.0, 700.0]
    assert second[700.0].getGlyphOrder() == first[700.0].getGlyphOrder()
    masters.MastersCache(tmp_path / "fam", "k2").get(build)
    assert len(calls) == 2


def test_the_key_ignores_names_but_not_inputs() -> None:
    raw = {"name": "Sawa A", "wght": {"min": 400}}
    base = masters.masters_key(raw, {"src": "aa"})
    assert base == masters.masters_key({**raw, "name": "Sawa B"}, {"src": "aa"})
    assert base != masters.masters_key(raw, {"src": "bb"})
    assert base != masters.masters_key({**raw, "wght": {"min": 500}}, {"src": "aa"})
