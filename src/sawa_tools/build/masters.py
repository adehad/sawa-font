"""Keeps a family's anchored static masters on disk between builds.

Anchoring (anchors.py) is most of a family build's time and depends only on
the family's inputs, its master-shaping config and the code that builds and
anchors masters, so a build whose release, names or licences alone changed
reuses the masters from the last build of the same key.
"""

from __future__ import annotations

import hashlib
import json
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any

from fontTools.ttLib import TTFont

if TYPE_CHECKING:
    from collections.abc import Callable, Mapping

# The modules whose code decides a master's glyphs, anchors and lookups.
MASTER_MODULES = ("anchors.py", "borrow.py", "harfbuzz.py", "ink.py", "merge.py")

# Family config keys that change only naming, licensing or publishing.
_NAMING_KEYS = ("name", "renameFrom", "notice", "licence", "site", "coverageGaps")

_INDEX = "masters.json"


def masters_key(family_raw: Mapping[str, Any], input_sha256s: Mapping[str, str]) -> str:
    import importlib.metadata

    from fontTools import version as fonttools_version

    digest = hashlib.sha256()
    payload = {
        "family": {k: v for k, v in family_raw.items() if k not in _NAMING_KEYS},
        "inputs": dict(sorted(input_sha256s.items())),
        "fonttools": fonttools_version,
        "uharfbuzz": importlib.metadata.version("uharfbuzz"),
    }
    digest.update(json.dumps(payload, sort_keys=True).encode("utf-8"))
    here = Path(__file__).parent
    for module in MASTER_MODULES:
        digest.update((here / module).read_bytes())
    return digest.hexdigest()


@dataclass(frozen=True)
class MastersCache:
    """One family's masters under `folder`, valid while `key` matches."""

    folder: Path
    key: str

    def get(self, build: Callable[[], Mapping[float, TTFont]]) -> dict[float, TTFont]:
        """The cached masters, or `build`'s, saved first.

        Either way the masters come back loaded from disk: compiling sets
        writer-side attributes on some subtables, and varLib needs every
        master to match attribute for attribute.
        """
        index = self.folder / _INDEX
        if index.exists():
            saved = json.loads(index.read_text(encoding="utf-8"))
            if saved.get("key") == self.key:
                return self._load(saved["locations"])
        if self.folder.exists():
            shutil.rmtree(self.folder)
        self.folder.mkdir(parents=True)
        masters = build()
        for location, master in masters.items():
            master.save(self.folder / f"{location:g}.ttf")
        locations = sorted(masters)
        index.write_text(
            json.dumps({"key": self.key, "locations": locations}), encoding="utf-8"
        )
        return self._load(locations)

    def _load(self, locations: list[float]) -> dict[float, TTFont]:
        return {
            float(w): TTFont(self.folder / f"{w:g}.ttf", recalcTimestamp=False)
            for w in locations
        }


def anchored(
    cache: MastersCache | None, build: Callable[[], Mapping[float, TTFont]]
) -> dict[float, TTFont]:
    return dict(build()) if cache is None else cache.get(build)
