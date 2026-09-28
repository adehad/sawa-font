from __future__ import annotations

import gzip
import unicodedata
from pathlib import Path

import pytest

from sawa_tools.report.bidi import BidiError, levels, paragraph_level

CONFORMANCE = Path(__file__).parent.parent / "data/unicode/BidiCharacterTest.txt.gz"
_EXPLICIT = {"LRE", "RLE", "LRO", "RLO", "PDF", "LRI", "RLI", "FSI", "PDI"}


def _cases() -> list[tuple[str, int, int, list[str]]]:
    cases = []
    for line in gzip.decompress(CONFORMANCE.read_bytes()).decode("utf-8").splitlines():
        if not line or line.startswith("#"):
            continue
        fields = line.split(";")
        text = "".join(chr(int(cp, 16)) for cp in fields[0].split())
        if any(unicodedata.bidirectional(ch) in _EXPLICIT for ch in text):
            continue
        cases.append((text, int(fields[1]), int(fields[2]), fields[3].split()))
    return cases


def test_file_matches_the_stdlib_unicode_version() -> None:
    header = gzip.decompress(CONFORMANCE.read_bytes()).decode("utf-8").splitlines()[0]
    assert header == f"# BidiCharacterTest-{unicodedata.unidata_version}.txt"


def test_bidi_character_test_without_explicit_controls() -> None:
    cases = _cases()
    failures = []
    for text, direction, want_para, want in cases:
        base = paragraph_level(text) if direction == 2 else direction
        got = levels(text, base)
        mismatch = base != want_para or any(
            w != "x" and int(w) != g for w, g in zip(want, got, strict=True)
        )
        if mismatch:
            failures.append(" ".join(f"{ord(ch):04X}" for ch in text))
    assert len(cases) == 91605
    assert failures == [], f"{len(failures)} of {len(cases)} fail, e.g. {failures[:5]}"


def test_explicit_controls_are_rejected() -> None:
    for control in ("‪", "‫", "‬", "‭", "‮", "⁦", "⁩"):
        with pytest.raises(BidiError):
            levels(f"a{control}b")


def test_brackets_follow_n0() -> None:
    # In an RTL paragraph, brackets holding only L follow the R before them.
    assert levels("א (a) ב", 1) == [1, 1, 1, 2, 1, 1, 1]
    # With L before them as well, they take the L of their content.
    assert levels("a א b(c) ב", 1)[4:8] == [2, 2, 2, 2]
