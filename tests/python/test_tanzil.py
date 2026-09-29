"""Pins the Tanzil texts so an accidental hand-edit fails CI.

data/tanzil/README.md explains why these files must never be edited by hand.
"""

import gzip
import hashlib
from pathlib import Path

import pytest

from sawa_tools import tanzil

DATA_DIR = Path(__file__).parents[2] / "data" / "tanzil"

COPYRIGHT_MARKER = b"# PLEASE DO NOT REMOVE OR CHANGE THIS COPYRIGHT BLOCK"

EXPECTED = {
    "uthmani-fatiha.txt": {
        "verses_sha256": (
            "2ba2195e4abc07d8551ba06ed4df0b956322f5106c777ff3bee0bdc805a0810a"
        ),
        "copyright_sha256": (
            "72493509d507314f60c018fd33aa57d9064a0de42be8926745e4953f59925c62"
        ),
    },
    "simple-clean-fatiha.txt": {
        "verses_sha256": (
            "219788b89b06bd6c399b771ee687d4dc6faae3106f124dc74195bd323168f08f"
        ),
        "copyright_sha256": (
            "b5eadb3c0c9a8c9a0cb055b78139c797cd81dda53ac3c6fbfb97c0b786a9d15d"
        ),
    },
}


def _split(data: bytes) -> tuple[bytes, bytes]:
    """Splits an excerpt file into (verse lines blob, copyright block)."""
    marker_index = data.find(COPYRIGHT_MARKER)
    assert marker_index != -1, "copyright marker not found"
    verses = data[:marker_index].rstrip(b"\n")
    copyright_block = data[marker_index:]
    return verses, copyright_block


@pytest.mark.parametrize("name", sorted(EXPECTED))
def test_excerpt_has_seven_non_empty_verse_lines(name: str) -> None:
    data = (DATA_DIR / name).read_bytes()
    verses, _ = _split(data)
    lines = verses.split(b"\n")
    assert len(lines) == 7
    assert all(lines)


@pytest.mark.parametrize("name", sorted(EXPECTED))
def test_excerpt_verse_lines_are_pinned(name: str) -> None:
    data = (DATA_DIR / name).read_bytes()
    verses, _ = _split(data)
    assert hashlib.sha256(verses).hexdigest() == EXPECTED[name]["verses_sha256"]


@pytest.mark.parametrize("name", sorted(EXPECTED))
def test_copyright_block_is_present_and_pinned(name: str) -> None:
    data = (DATA_DIR / name).read_bytes()
    _, copyright_block = _split(data)
    assert copyright_block.startswith(COPYRIGHT_MARKER)
    assert (
        hashlib.sha256(copyright_block).hexdigest()
        == EXPECTED[name]["copyright_sha256"]
    )


FULL_UTHMANI_SHA256 = "0fa31b4f07d72bf85e8052575a33315566322eb905bef7d839b100ac0ef7b683"


def test_full_uthmani_text_is_the_pinned_download() -> None:
    data = gzip.decompress((DATA_DIR / "quran-uthmani.txt.gz").read_bytes())
    assert hashlib.sha256(data).hexdigest() == FULL_UTHMANI_SHA256
    _, copyright_block = _split(data)
    assert b"Tanzil Project" in copyright_block


def test_uthmani_loader_returns_every_verse_in_order() -> None:
    verses = tanzil.uthmani(DATA_DIR / "quran-uthmani.txt.gz")
    assert len(verses) == tanzil.VERSE_COUNT == 6236
    fatiha = (DATA_DIR / "uthmani-fatiha.txt").read_text(encoding="utf-8")
    assert verses[:7] == tanzil.verse_lines(fatiha)
    assert not any(v.startswith("#") for v in verses)


def test_verse_lines_drop_the_copyright_block() -> None:
    text = f"one\ntwo\n\n{COPYRIGHT_MARKER.decode()}\n# x\n"
    assert tanzil.verse_lines(text) == ["one", "two"]


def test_verse_refs_count_ayahs_per_surah() -> None:
    assert tanzil.verse_ref(0) == "1:1"
    assert tanzil.verse_ref(7) == "2:1"
    assert tanzil.verse_ref(6235) == "114:6"
    with pytest.raises(IndexError):
        tanzil.verse_ref(6236)
