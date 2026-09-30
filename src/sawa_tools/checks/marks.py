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
DEFAULT_FONTS = (
    Path("site/public/fonts/sawa-serif/SawaSerif.woff2"),
    Path("site/public/fonts/sawa-sans/SawaSans.woff2"),
    Path("site/public/fonts/sawa-mono/SawaMono.woff2"),
    Path("site/public/fonts/sawa-serif-harakat/SawaSerifHarakat.woff2"),
    Path("site/public/fonts/sawa-sans-harakat/SawaSansHarakat.woff2"),
)
HARAKAT_SUFFIX = "Harakat"

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
        action="append",
        dest="fonts",
        help="Path to a font to check cmap coverage against, relative to the "
        "cwd; repeat for several (default: the Sawa site woff2 files)",
    )
    parser.set_defaults(handler=run)


def run(args: argparse.Namespace) -> int:
    failed = False
    for font_path in args.fonts or DEFAULT_FONTS:
        try:
            result = check_marks(
                groups_path=args.groups,
                font_path=font_path,
                plain_path=plain_twin(font_path),
            )
        except MarksError as exc:
            print(f"error: {exc}", file=sys.stderr)
            return 1
        for error in result.errors:
            print(error, file=sys.stderr)
        if result.errors:
            failed = True
            continue
        print(
            f"OK: {font_path}: {result.group_count} group(s), "
            f"{result.codepoint_count} codepoint(s), font cmap fully covered"
        )
    return 1 if failed else 0


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


def plain_twin(font_path: Path) -> Path | None:
    """The plain family's woff2 beside a Harakat twin's, or None for any other font."""
    if not font_path.stem.endswith(HARAKAT_SUFFIX):
        return None
    directory = font_path.parent.name.removesuffix("-harakat")
    return (
        font_path.parent.parent
        / directory
        / (font_path.stem.removesuffix(HARAKAT_SUFFIX) + font_path.suffix)
    )


def twin_errors(groups_path: Path, font_path: Path, plain_path: Path) -> list[str]:
    """Errors in a Harakat twin's mark coverage against its plain family.

    The twin must map the same Arabic combining marks, and its COLR base glyphs
    must be exactly the plain family's glyphs of the marks in the groups.
    """
    from sawa_tools.build.harakat import HarakatError, load_groups
    from sawa_tools.checks.harakat import colr_errors

    if plain_path.suffix == ".woff2" and not plain_path.exists():
        raise MarksError(f"font not found: {plain_path}; run `sawa build fonts` first")
    errors = []
    twin_marks = font_arabic_mark_codepoints(font_path)
    plain_marks = font_arabic_mark_codepoints(plain_path)
    if twin_marks != plain_marks:
        diff = ", ".join(f"U+{cp:04X}" for cp in sorted(twin_marks ^ plain_marks))
        errors.append(f"{font_path}: marks differ from {plain_path.name}: {diff}")
    ttfont_class = _load_ttfont_class()
    try:
        grouped = load_groups(groups_path)
    except HarakatError as exc:
        raise MarksError(str(exc)) from exc
    font, plain = ttfont_class(font_path), ttfont_class(plain_path)
    try:
        # A woff2 transforms glyf and gvar, which only decompile correctly
        # before glyphs are added to the font.
        plain.ensureDecompiled()
        errors += [f"{font_path}: {e}" for e in colr_errors(font, plain, grouped)]
    finally:
        font.close()
        plain.close()
    return errors


def check_marks(
    *, groups_path: Path, font_path: Path, plain_path: Path | None = None
) -> CheckResult:
    """Runs every mark-group check: group structure, then font cmap coverage,
    then, for a Harakat twin given its `plain_path`, agreement with that family.
    """
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
    if plain_path is not None:
        errors += twin_errors(groups_path, font_path, plain_path)
    return CheckResult(errors, len(groups), codepoint_count)
