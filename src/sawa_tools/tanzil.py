"""The Tanzil Quran text vendored in data/tanzil/ (see its README)."""

from __future__ import annotations

import gzip
from pathlib import Path

DEFAULT_UTHMANI = Path("data/tanzil/quran-uthmani.txt.gz")

COPYRIGHT_MARKER = "# PLEASE DO NOT REMOVE OR CHANGE THIS COPYRIGHT BLOCK"

# Verses per surah, in order.
AYAH_COUNTS = (
    7, 286, 200, 176, 120, 165, 206, 75, 129, 109, 123, 111, 43, 52, 99, 128,
    111, 110, 98, 135, 112, 78, 118, 64, 77, 227, 93, 88, 69, 60, 34, 30, 73,
    54, 45, 83, 182, 88, 75, 85, 54, 53, 89, 59, 37, 35, 38, 29, 18, 45, 60,
    49, 62, 55, 78, 96, 29, 22, 24, 13, 14, 11, 11, 18, 12, 12, 30, 52, 52, 44,
    28, 28, 20, 56, 40, 31, 50, 40, 46, 42, 29, 19, 36, 25, 22, 17, 19, 26, 30,
    20, 15, 21, 11, 8, 8, 19, 5, 8, 8, 11, 11, 8, 3, 9, 5, 4, 7, 3, 6, 3, 5, 4,
    5, 6,
)  # fmt: skip
VERSE_COUNT = sum(AYAH_COUNTS)


class TanzilError(Exception):
    """Raised when a Tanzil file is not the text its README describes."""


def verse_lines(text: str) -> list[str]:
    """The verse lines of a Tanzil file, without its copyright block."""
    verses = text.split(COPYRIGHT_MARKER, 1)[0]
    return [line for line in verses.splitlines() if line.strip()]


def uthmani(path: Path = DEFAULT_UTHMANI) -> list[str]:
    """Every verse of the full Uthmani text, one line each, in mushaf order."""
    try:
        text = gzip.decompress(path.read_bytes()).decode("utf-8")
    except (OSError, EOFError, UnicodeDecodeError) as exc:
        raise TanzilError(f"cannot read {path}: {exc}") from exc
    lines = verse_lines(text)
    if len(lines) != VERSE_COUNT:
        raise TanzilError(f"{path} has {len(lines)} verses, not {VERSE_COUNT}")
    return lines


def verse_ref(index: int) -> str:
    """The "surah:ayah" of the verse at 0-based `index` in mushaf order."""
    if index >= 0:
        for surah, count in enumerate(AYAH_COUNTS, start=1):
            if index < count:
                return f"{surah}:{index + 1}"
            index -= count
    raise IndexError(index)
