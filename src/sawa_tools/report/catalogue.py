"""The report's test list: the stress set, the mixed sentences and Al-Fatiha 1:1."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from sawa_tools.tanzil import verse_lines

DEFAULT_STRESS = Path("tests/strings/stress.json")
DEFAULT_MIXED = Path("tests/strings/mixed.json")
DEFAULT_TANZIL = Path("data/tanzil/uthmani-fatiha.txt")

_MIXED_PURPOSE = {
    "en": "A mixed English and Arabic sentence, set on one line.",
    "ar": "جملة تمزج الإنجليزية والعربية في سطر واحد.",
}
_FATIHA_PURPOSE = {
    "en": "Al-Fatiha 1:1 in Tanzil's Uthmani text, fully vowelled.",
    "ar": "الآية الأولى من سورة الفاتحة بالرسم العثماني من تنزيل، مشكولة بالكامل.",
}


class CatalogueError(Exception):
    """Raised when a test source file is missing or malformed."""


@dataclass(frozen=True)
class ReportTest:
    id: str
    text: str
    purpose: dict[str, str]
    features: list[str] = field(default_factory=list)

    @property
    def feature_settings(self) -> dict[str, bool]:
        return dict.fromkeys(self.features, True)


def _read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise CatalogueError(f"cannot read {path}: {exc}") from exc


def load_tests(
    stress: Path = DEFAULT_STRESS,
    mixed: Path = DEFAULT_MIXED,
    tanzil: Path = DEFAULT_TANZIL,
) -> list[ReportTest]:
    tests = [
        ReportTest(
            id=entry["id"],
            text=entry["text"],
            purpose=entry["purpose"],
            features=list(entry.get("features", [])),
        )
        for entry in _read_json(stress)["tests"]
    ]
    tests += [
        ReportTest(
            id=f"mixed-{entry['id']}", text=entry["text"], purpose=_MIXED_PURPOSE
        )
        for entry in _read_json(mixed)["sentences"]
    ]
    try:
        verses = verse_lines(tanzil.read_text(encoding="utf-8"))
    except OSError as exc:
        raise CatalogueError(f"cannot read {tanzil}: {exc}") from exc
    tests.append(ReportTest(id="fatiha-1", text=verses[0], purpose=_FATIHA_PURPOSE))
    ids = [test.id for test in tests]
    if len(set(ids)) != len(ids):
        raise CatalogueError(f"duplicate test ids in {ids}")
    return tests
