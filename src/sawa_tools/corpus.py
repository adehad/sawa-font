"""The lines compaction fits and `sawa check leading` measures: the full
Tanzil Uthmani text, one verse per line, then the stress strings and the
mixed sentences.

Arabic marks are everyday tashkeel, the harakat and signs of ordinary
vocalised text, or niche: the other Quranic annotation marks. A line's
everyday view drops its niche marks.
"""

from __future__ import annotations

import json
import re
import unicodedata
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from sawa_tools.tanzil import TanzilError, uthmani, verse_ref

DEFAULT_STRESS = Path("tests/strings/stress.json")
DEFAULT_MIXED = Path("tests/strings/mixed.json")

EVERYDAY_MARKS = frozenset(
    [*range(0x064B, 0x0656), 0x0670, 0x06E1, 0x08F0, 0x08F1, 0x08F2]
)
_ARABIC_BLOCKS = ((0x0600, 0x06FF), (0x0750, 0x077F), (0x08A0, 0x08FF))
_SPACES = re.compile(r" {2,}")


def is_niche_mark(cp: int) -> bool:
    """Whether `cp` is an Arabic combining mark outside everyday tashkeel."""
    return (
        cp not in EVERYDAY_MARKS
        and unicodedata.category(chr(cp)) == "Mn"
        and any(low <= cp <= high for low, high in _ARABIC_BLOCKS)
    )


def mark_samples() -> tuple[str, ...]:
    """Every everyday mark, and every ordered pair of two of them, on each
    letter `sawa check fonts` places marks on.
    """
    from sawa_tools.checks.attachment import BASES

    marks = [chr(cp) for cp in sorted(EVERYDAY_MARKS)]
    samples = []
    for _, text, index in BASES:
        before, after = text[: index + 1], text[index + 1 :]
        samples += [before + a + after for a in marks]
        samples += [before + a + b + after for a in marks for b in marks if a != b]
    return tuple(samples)


def everyday(text: str) -> str:
    """`text` without its niche marks, and without the doubled spaces a
    dropped pause mark leaves between words.
    """
    kept = "".join(ch for ch in text if not is_niche_mark(ord(ch)))
    return _SPACES.sub(" ", kept) if kept != text else text


class CorpusError(Exception):
    """Raised when a corpus file cannot be read."""


@dataclass(frozen=True)
class Part:
    """One corpus part, as (label, text) lines; consecutive lines are
    neighbours only within a part.
    """

    name: str
    lines: tuple[tuple[str, str], ...]


def _read(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise CorpusError(f"cannot read {path}: {exc}") from exc


def corpus(
    quran: Path | None, stress: Path = DEFAULT_STRESS, mixed: Path = DEFAULT_MIXED
) -> list[Part]:
    """The corpus parts, without the Quran text when `quran` is None."""
    parts = []
    if quran is not None:
        try:
            verses = uthmani(quran)
        except TanzilError as exc:
            raise CorpusError(str(exc)) from exc
        parts.append(
            Part("quran", tuple((verse_ref(i), v) for i, v in enumerate(verses)))
        )
    tests = _read(stress)["tests"]
    parts.append(Part("stress", tuple((t["id"], t["text"]) for t in tests)))
    sentences = _read(mixed)["sentences"]
    parts.append(Part("mixed", tuple((s["id"], s["text"]) for s in sentences)))
    return parts


def texts(parts: list[Part]) -> tuple[str, ...]:
    return tuple(text for part in parts for _, text in part.lines)
