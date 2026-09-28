"""coverage.json: per family, cmap coverage by Unicode block, mark group and
glyph set, next to the same numbers for its upstream fonts.

A block's numbers count only codepoints a font is expected to map: assigned
(not Cn) and neither controls (Cc), surrogates (Cs) nor private use (Co),
in the Unicode version fontTools.unicodedata carries, which coverage.json
records.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from collections.abc import Iterable
    from pathlib import Path

    from sawa_tools.report.sources import ReportFamily

GLYPHSETS = [
    "GF_Latin_Core",
    "GF_Latin_Plus",
    "GF_Arabic_Core",
    "GF_Arabic_Plus",
    "GF_TransLatin_Arabic",
]

_UNCOUNTED = {"Cn", "Cc", "Cs", "Co"}

# SAWA_PLAN.md §2.16: the ALA-LC / DIN 31635 letters a release must keep.
ROMANISATION = "ḥṣḍṭẓʿʾāīūḏṯẖġšžčǧ"


def cmap_of(paths: Iterable[Path]) -> set[int]:
    from fontTools.ttLib import TTFont

    codepoints: set[int] = set()
    for path in paths:
        codepoints |= set((TTFont(path, lazy=True).getBestCmap() or {}).keys())
    return codepoints


def _block_table() -> list[tuple[int, int, str]]:
    from fontTools.unicodedata import Blocks

    ends = [*Blocks.RANGES[1:], 0x110000]
    return [
        (start, end - 1, name)
        for start, end, name in zip(Blocks.RANGES, ends, Blocks.VALUES, strict=True)
    ]


def block_name(cp: int) -> str:
    from fontTools import unicodedata

    return unicodedata.block(chr(cp))


def _countable(cp: int) -> bool:
    from fontTools import unicodedata

    return unicodedata.category(chr(cp)) not in _UNCOUNTED


def block_coverage(cmap: set[int], blocks: set[str]) -> dict[str, dict[str, int]]:
    """Supported/total for each named block, in codepoint order."""
    result = {}
    for start, end, name in _block_table():
        if name not in blocks or name == "No_Block":
            continue
        counted = [cp for cp in range(start, end + 1) if _countable(cp)]
        supported = sum(1 for cp in counted if cp in cmap)
        result[name] = {"supported": supported, "total": len(counted)}
    return result


def _set_coverage(cmap: set[int], wanted: set[int]) -> dict[str, Any]:
    missing = sorted(wanted - cmap)
    return {
        "supported": len(wanted) - len(missing),
        "total": len(wanted),
        "missing": [f"U+{cp:04X}" for cp in missing],
    }


def glyphset_codepoints() -> dict[str, set[int]]:
    import glyphsets

    sets = {name: set(glyphsets.unicodes_per_glyphset(name)) for name in GLYPHSETS}
    sets["arabic-romanisation"] = {ord(ch) for ch in ROMANISATION}
    return sets


def _font_coverage(
    cmap: set[int],
    blocks: set[str],
    groups: dict[str, set[int]],
    sets: dict[str, set[int]],
) -> dict[str, Any]:
    return {
        "codepoints": len(cmap),
        "blocks": block_coverage(cmap, blocks),
        "markGroups": {gid: _set_coverage(cmap, cps) for gid, cps in groups.items()},
        "glyphSets": {name: _set_coverage(cmap, cps) for name, cps in sets.items()},
    }


def build_coverage(
    families: list[ReportFamily], groups: dict[str, set[int]]
) -> dict[str, Any]:
    sets = glyphset_codepoints()
    result: dict[str, Any] = {}
    for family in families:
        sawa = cmap_of([family.ttf])
        upstream = cmap_of(family.upstream)
        blocks = {block_name(cp) for cp in sawa | upstream}
        result[family.id] = {
            **_font_coverage(sawa, blocks, groups, sets),
            "upstream": {
                "id": family.upstream_id,
                "fonts": family.upstream_names,
                **_font_coverage(upstream, blocks, groups, sets),
            },
        }
    from fontTools import unicodedata

    return {
        "unicodeVersion": unicodedata.unidata_version,
        "glyphSetsSource": "glyphsets",
        "families": result,
    }
