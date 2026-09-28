"""Checks data/mark-groups.json and its coverage of a font's Arabic combining marks.

Codepoints in mark-groups.json are written as "U+XXXX" or, for a contiguous
run, "U+XXXX..U+YYYY" (both ends inclusive). This is the only range syntax
the loader accepts.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from pathlib import Path
from typing import TYPE_CHECKING, NamedTuple

if TYPE_CHECKING:
    from collections.abc import Iterator

DEFAULT_GROUPS = Path("data/mark-groups.json")
DEFAULT_FONT = Path("site/public/fonts/sawa/Sawa-Regular.woff2")

# The Arabic script's Unicode blocks: Arabic, Arabic Supplement, Arabic
# Extended-A, Arabic Presentation Forms-A and -B.
ARABIC_BLOCKS = (
    (0x0600, 0x06FF),
    (0x0750, 0x077F),
    (0x08A0, 0x08FF),
    (0xFB50, 0xFDFF),
    (0xFE70, 0xFEFF),
)

_SINGLE_RE = re.compile(r"^U\+([0-9A-Fa-f]{4,6})$")
_RANGE_RE = re.compile(r"^U\+([0-9A-Fa-f]{4,6})\.\.U\+([0-9A-Fa-f]{4,6})$")


class MarksError(Exception):
    """Raised for a failure that should stop the check with a clear message."""


class CheckResult(NamedTuple):
    errors: list[str]
    group_count: int
    codepoint_count: int


def add_parser(subparsers: argparse._SubParsersAction) -> None:
    parser = subparsers.add_parser(
        "marks", help="Check mark-group coverage against the font's cmap"
    )
    parser.add_argument(
        "--groups",
        type=Path,
        default=DEFAULT_GROUPS,
        help="Path to the mark-groups manifest, relative to the cwd "
        "(default: %(default)s)",
    )
    parser.add_argument(
        "--font",
        type=Path,
        default=DEFAULT_FONT,
        help="Path to the font to check cmap coverage against, relative to "
        "the cwd (default: %(default)s)",
    )
    parser.set_defaults(handler=run)


def run(args: argparse.Namespace) -> int:
    try:
        result = check_marks(groups_path=args.groups, font_path=args.font)
    except MarksError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    if result.errors:
        for error in result.errors:
            print(error, file=sys.stderr)
        return 1
    print(
        f"OK: {result.group_count} group(s), {result.codepoint_count} "
        "codepoint(s), font cmap fully covered"
    )
    return 0


def _parse_codepoints(spec: str) -> Iterator[int]:
    """Yields the codepoints named by a single "U+XXXX" or "U+XXXX..U+YYYY" spec."""
    match = _RANGE_RE.match(spec)
    if match:
        low, high = int(match.group(1), 16), int(match.group(2), 16)
        if low > high:
            raise MarksError(f"invalid range (start after end): {spec!r}")
        yield from range(low, high + 1)
        return
    match = _SINGLE_RE.match(spec)
    if match:
        yield int(match.group(1), 16)
        return
    raise MarksError(f"invalid codepoint: {spec!r}")


def load_groups(groups_path: Path) -> tuple[dict[str, set[int]], list[str]]:
    """Loads mark-groups.json into {group id: set of codepoints}.

    Returns (groups, errors). `errors` reports an invalid codepoint spec or a
    codepoint claimed by more than one group; `groups` still holds whatever
    parsed successfully, so a caller can decide whether to continue.
    """
    try:
        data = json.loads(groups_path.read_text(encoding="utf-8"))
    except OSError as exc:
        raise MarksError(f"cannot read {groups_path}: {exc}") from exc
    except json.JSONDecodeError as exc:
        raise MarksError(f"invalid JSON in {groups_path}: {exc}") from exc

    if not isinstance(data, dict) or not isinstance(data.get("groups"), list):
        raise MarksError(f"{groups_path}: expected a top-level {{'groups': [...]}}")

    groups: dict[str, set[int]] = {}
    errors: list[str] = []
    owner: dict[int, str] = {}
    for entry in data["groups"]:
        group_id = entry.get("id")
        if not isinstance(group_id, str) or not group_id:
            errors.append(f"{groups_path}: a group is missing a string 'id'")
            continue
        codepoints: set[int] = set()
        for spec in entry.get("codepoints", []):
            try:
                for cp in _parse_codepoints(spec):
                    if cp in owner:
                        errors.append(
                            f"{groups_path}: U+{cp:04X} is in both "
                            f"'{owner[cp]}' and '{group_id}'"
                        )
                    else:
                        owner[cp] = group_id
                    codepoints.add(cp)
            except MarksError as exc:
                errors.append(f"{groups_path}: group '{group_id}': {exc}")
        groups[group_id] = codepoints
    return groups, errors


def _load_ttfont_class() -> type:
    """Imports fontTools.ttLib.TTFont lazily, with a clear error if it's missing."""
    try:
        from fontTools.ttLib import TTFont
    except ImportError as exc:
        raise MarksError(
            "fontTools is required to check a font's cmap; install the "
            "'build' dependency group (uv run --group build sawa check marks)"
        ) from exc
    return TTFont


def font_arabic_mark_codepoints(font_path: Path) -> set[int]:
    """Returns every codepoint in `font_path`'s cmap that is Unicode category Mn
    (a combining mark) and falls in one of the Arabic blocks.
    """
    if not font_path.exists():
        raise MarksError(f"font not found: {font_path}; run `sawa build fonts` first")
    ttfont_class = _load_ttfont_class()
    font = ttfont_class(font_path, lazy=True)
    try:
        cmap = font.getBestCmap()
    finally:
        font.close()
    result = set()
    for cp in cmap:
        if any(low <= cp <= high for low, high in ARABIC_BLOCKS) and (
            unicodedata.category(chr(cp)) == "Mn"
        ):
            result.add(cp)
    return result


def check_marks(*, groups_path: Path, font_path: Path) -> CheckResult:
    """Runs every mark-group check: group structure, then font cmap coverage."""
    groups, errors = load_groups(groups_path)
    codepoint_count = sum(len(cps) for cps in groups.values())
    if errors:
        return CheckResult(errors, len(groups), codepoint_count)

    assigned = set.union(*groups.values()) if groups else set()
    font_marks = font_arabic_mark_codepoints(font_path)
    missing = sorted(font_marks - assigned)
    if missing:
        names = ", ".join(f"U+{cp:04X}" for cp in missing)
        errors.append(
            f"{font_path}: {len(missing)} Arabic combining mark(s) in no group: {names}"
        )
    return CheckResult(errors, len(groups), codepoint_count)
